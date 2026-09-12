'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { NotificationFeed } from '@clinic/contracts'
import { Button, cn } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * The bell (section 8.12).
 *
 * Polled rather than pushed, deliberately. A websocket for a count that changes a handful of
 * times a day is a connection to keep alive, authenticate, scale and reconnect — and the whole
 * benefit would be seeing a number change a minute sooner. The poll pauses while the tab is
 * hidden, so a laptop left open overnight is not making a request a minute until morning.
 *
 * Opening the panel marks what is in it read: the alternative is a per-row button nobody uses
 * and an unread count that only ever grows.
 */
const POLL_MS = 60_000

export function NotificationBell() {
  const t = useTranslations('notifications')
  const router = useRouter()
  const [feed, setFeed] = useState<NotificationFeed>({ items: [], unreadCount: 0 })
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      setFeed(await apiFetch<NotificationFeed>('/api/v1/me/notifications?limit=10'))
    } catch {
      // A bell that cannot load is not worth interrupting anybody over; the next tick retries.
    }
  }, [])

  useEffect(() => {
    void load()
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(tick)
  }, [load])

  // Close on a click anywhere else, and on Escape — the two ways anybody dismisses a panel.
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || feed.unreadCount === 0) return
    try {
      await apiFetch('/api/v1/me/notifications', { method: 'POST', body: { ids: [] } })
      setFeed((current) => ({
        items: current.items.map((item) => ({ ...item, isRead: true })),
        unreadCount: 0,
      }))
    } catch {
      // Leave them unread rather than lying about it; the next open tries again.
    }
  }

  return (
    <div className="relative" ref={panel}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={
          feed.unreadCount > 0 ? t('bellWithCount', { count: feed.unreadCount }) : t('bell')
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => void toggle()}
      >
        <Bell className="size-5" aria-hidden="true" />
        {feed.unreadCount > 0 ? (
          <span
            data-testid="unread-count"
            className="bg-danger text-danger-foreground absolute end-1 top-1 min-w-4 rounded-full px-1 text-[10px] leading-4 font-semibold tabular-nums"
          >
            {feed.unreadCount > 9 ? '9+' : feed.unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('bell')}
          className="border-border bg-card absolute end-0 z-40 mt-2 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-lg border shadow-lg"
        >
          <p className="border-border border-b px-4 py-3 text-sm font-semibold">{t('title')}</p>
          {feed.items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t('none')}</p>
          ) : (
            <ul className="divide-border divide-y overflow-y-auto">
              {feed.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      'hover:bg-muted flex w-full flex-col gap-0.5 px-4 py-3 text-start',
                      !item.isRead && 'bg-muted/40',
                    )}
                    onClick={() => {
                      setOpen(false)
                      if (item.href) router.push(item.href)
                    }}
                  >
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="text-muted-foreground text-xs">{item.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/account#notifications"
            onClick={() => setOpen(false)}
            className="border-border text-muted-foreground hover:text-foreground border-t px-4 py-2.5 text-center text-xs"
          >
            {t('managePreferences')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
