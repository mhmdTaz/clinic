'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { OpenTicketRequest, type TicketDetail } from '@clinic/contracts'
import { TICKET_CATEGORIES } from '@clinic/config'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  Spinner,
  Textarea,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Asking the clinic something (P9, D16).
 *
 * No priority field: how urgent something is, is the clinic's judgement rather than the asker's,
 * and the server ignores it from anybody who is not clinic-side. Offering a control the server
 * discards would be worse than not offering it.
 */
export function OpenTicketDialog({ label, basePath }: { label: string; basePath: string }) {
  const t = useTranslations('support.open')
  const tCategory = useTranslations('support.categories')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<string>('OTHER')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = OpenTicketRequest.safeParse({
        subject,
        category,
        priority: 'NORMAL',
        body,
        fileIds: [],
        requesterId: null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      const ticket = await apiFetch<TicketDetail>('/api/v1/support/tickets', {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      router.push(`${basePath}/${ticket.id}`)
    } catch (caught) {
      setError(errorMessage(caught))
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setSubject('')
          setCategory('OTHER')
          setBody('')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-subject`}>{t('subject')}</Label>
            <Input
              id={`${fieldId}-subject`}
              value={subject}
              maxLength={160}
              required
              autoFocus
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-category`}>{t('category')}</Label>
            <Select
              id={`${fieldId}-category`}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {TICKET_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {tCategory(option)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-message`}>{t('message')}</Label>
            <Textarea
              id={`${fieldId}-message`}
              rows={5}
              value={body}
              maxLength={4000}
              required
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || subject.trim() === '' || body.trim() === ''}
            onClick={() => void submit()}
          >
            {pending ? <Spinner className="size-4" /> : null}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
