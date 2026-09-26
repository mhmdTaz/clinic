'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ToothState } from '@clinic/contracts'
import { Button, cn } from '@clinic/ui'
import type { JawEngine, JawView } from './jaw/engine'
import { SymbolIcon } from './symbol-icon'
import { toneOf, toothVisual } from './tooth-visual'

/**
 * The 3D jaw. three.js and the tooth meshes are loaded only when this view is first shown, so a
 * page that never opens it never pays for it (the chart's parent imports this lazily).
 *
 * The component owns the controls around the canvas; the engine owns the canvas. Badges are
 * ordinary React elements the engine moves every frame, so they read like the rest of the page.
 */
export function Jaw3D({
  dentition,
  teeth,
  selected,
  highlight,
  active,
  onSelect,
  toothLabel,
}: {
  dentition: 'PERMANENT' | 'PRIMARY'
  teeth: readonly ToothState[]
  selected: string | null
  highlight: readonly string[]
  active: boolean
  onSelect: (fdi: string) => void
  toothLabel: (fdi: string) => string
}) {
  const t = useTranslations('dental')
  const stage = useRef<HTMLDivElement>(null)
  const engine = useRef<JawEngine | null>(null)
  const badgeElements = useRef(new Map<string, HTMLElement>())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const [progress, setProgress] = useState<{ done: number; total: number } | null>({
    done: 0,
    total: 1,
  })
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState<{ fdi: string; x: number; y: number } | null>(null)
  const [xray, setXray] = useState(false)
  const [open, setOpen] = useState(false)

  const visuals = useMemo(
    () => new Map(teeth.map((tooth) => [tooth.fdi, toothVisual(tooth)])),
    [teeth],
  )

  useEffect(() => {
    let disposed = false
    let created: JawEngine | null = null
    ;(async () => {
      try {
        const [{ createJawEngine }, { prepareGeometry }] = await Promise.all([
          import('./jaw/engine'),
          import('./jaw/tooth-geometry'),
        ])
        await prepareGeometry(dentition === 'PRIMARY', (done, total) => {
          if (!disposed) setProgress({ done, total })
        })
        if (disposed || !stage.current) return
        created = createJawEngine(stage.current, dentition, {
          onPick: (fdi) => onSelectRef.current(fdi),
          onHover: (fdi, at) => setHover(fdi && at ? { fdi, ...at } : null),
        })
        engine.current = created
        setProgress(null)
      } catch {
        // No WebGL, or a context the browser refused: the chart's parent falls back to 2D.
        if (!disposed) setFailed(true)
      }
    })()
    return () => {
      disposed = true
      created?.dispose()
      engine.current = null
    }
  }, [dentition])

  useEffect(() => {
    engine.current?.setTeeth(visuals)
    engine.current?.setBadges(badgeElements.current)
  }, [visuals, progress])

  useEffect(() => engine.current?.setSelected(selected), [selected, progress])
  useEffect(() => engine.current?.setHighlight(highlight), [highlight, progress])
  useEffect(() => engine.current?.setActive(active), [active, progress])
  useEffect(() => engine.current?.setXray(xray), [xray, progress])
  useEffect(() => engine.current?.setOpen(open), [open, progress])

  const view = (next: JawView) => engine.current?.setView(next)
  const hovered = hover ? visuals.get(hover.fdi) : null

  if (failed) {
    return (
      <div className="bg-muted text-muted-foreground flex h-[420px] items-center justify-center rounded-lg p-6 text-sm">
        {t('noWebgl')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => view('front')}>
          {t('views.front')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => view('right')}>
          {t('views.right')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => view('upper')}>
          {t('views.upper')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => view('lower')}>
          {t('views.lower')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t('closeMouth') : t('openMouth')}
        </Button>
        <Button
          size="sm"
          variant={xray ? 'secondary' : 'outline'}
          aria-pressed={xray}
          onClick={() => setXray((value) => !value)}
        >
          {xray ? t('normalView') : t('xray')}
        </Button>
      </div>

      <div
        ref={stage}
        className="relative h-[460px] cursor-grab overflow-hidden rounded-lg bg-[#16191d]"
        role="application"
        aria-label={t('jawLabel')}
      >
        {progress ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#b4b2a9]">
            {t('sculpting', { done: progress.done, total: progress.total })}
          </div>
        ) : (
          <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-[#b4b2a9]">
            {t('hint')}
          </p>
        )}
        {teeth.map((tooth) => {
          const latest = visuals.get(tooth.fdi)?.latest
          if (!latest) return null
          return (
            <span
              key={tooth.fdi}
              ref={(element) => {
                if (element) badgeElements.current.set(tooth.fdi, element)
                else badgeElements.current.delete(tooth.fdi)
              }}
              className={cn(
                'pointer-events-none absolute top-0 left-0 hidden h-6 w-6 items-center justify-center rounded-full border',
                toneOf(latest.status) === 'done'
                  ? 'border-[#85B7EB] bg-[#E6F1FB] text-[#0C447C]'
                  : 'border-[#F09595] bg-[#FCEBEB] text-[#A32D2D]',
              )}
            >
              <SymbolIcon symbol={latest.symbol} size={13} />
            </span>
          )
        })}
        {hover ? (
          <div
            className="pointer-events-none absolute rounded-md bg-black/80 px-2 py-1 text-xs whitespace-nowrap text-[#f1efe8]"
            style={{ left: hover.x + 14, top: hover.y + 10 }}
          >
            {toothLabel(hover.fdi)}
            {hovered?.latest
              ? ` · ${t(`symbols.${hovered.latest.symbol}`)} (${t(`statuses.${hovered.latest.status}`)})`
              : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}
