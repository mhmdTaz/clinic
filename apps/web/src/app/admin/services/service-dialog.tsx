'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ServiceInput, type Service } from '@clinic/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Adding or editing a priced service (A6). One dialog for both, because the fields are the same
 * and two near-identical forms is how they drift apart.
 */
export function ServiceDialog({
  service,
  currency,
  label,
}: {
  service?: Service
  currency: string
  label: string
}) {
  const t = useTranslations('admin.services.form')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState(service?.name ?? '')
  const [description, setDescription] = useState(service?.description ?? '')
  const [price, setPrice] = useState(service?.price ?? '')
  const [taxRatePercent, setTaxRatePercent] = useState(service?.taxRatePercent ?? '0')
  const [durationMinutes, setDurationMinutes] = useState(
    service?.durationMinutes ? String(service.durationMinutes) : '',
  )
  const [isActive, setIsActive] = useState(service?.isActive ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset(next: boolean) {
    setOpen(next)
    if (!next) return
    setName(service?.name ?? '')
    setDescription(service?.description ?? '')
    setPrice(service?.price ?? '')
    setTaxRatePercent(service?.taxRatePercent ?? '0')
    setDurationMinutes(service?.durationMinutes ? String(service.durationMinutes) : '')
    setIsActive(service?.isActive ?? true)
    setError(null)
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = ServiceInput.safeParse({
        name,
        description: description.trim() === '' ? null : description,
        price,
        taxRatePercent: taxRatePercent.trim() === '' ? '0' : taxRatePercent,
        durationMinutes: durationMinutes.trim() === '' ? null : durationMinutes,
        isActive,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(
        service ? `/api/v1/billing/services/${service.id}` : '/api/v1/billing/services',
        { method: service ? 'PUT' : 'POST', body: parsed.data },
      )
      setOpen(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant={service ? 'ghost' : 'primary'} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('body', { currency })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-name`}>{t('name')}</Label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              maxLength={120}
              required
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-description`}>{t('description')}</Label>
            <Input
              id={`${fieldId}-description`}
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-price`}>{t('price')}</Label>
              <Input
                id={`${fieldId}-price`}
                value={price}
                inputMode="decimal"
                required
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-tax`}>{t('taxRate')}</Label>
              <Input
                id={`${fieldId}-tax`}
                value={taxRatePercent}
                inputMode="decimal"
                onChange={(event) => setTaxRatePercent(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-duration`}>{t('duration')}</Label>
              <Input
                id={`${fieldId}-duration`}
                value={durationMinutes}
                inputMode="numeric"
                onChange={(event) => setDurationMinutes(event.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            {t('active')}
          </label>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || name.trim() === '' || price.trim() === ''}
            onClick={() => void submit()}
          >
            {pending ? <Spinner className="size-4" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
