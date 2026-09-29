'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { DENTAL_SCOPES, DENTAL_SYMBOLS } from '@clinic/config'
import {
  DentalTreatmentInput,
  issueCode,
  issuePath,
  type DentalScope,
  type DentalSymbol,
  type DentalTreatment,
} from '@clinic/contracts'
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
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Adding or editing a treatment the tooth chart offers. Once a treatment exists, what it draws —
 * its symbol and scope — is fixed: the server refuses a change, so the form does not offer one,
 * and says why.
 */
export function TreatmentDialog({
  treatment,
  services,
  label,
}: {
  treatment?: DentalTreatment
  services: ReadonlyArray<{ id: string; name: string }>
  label: string
}) {
  const t = useTranslations('admin.dental.treatmentForm')
  const tDental = useTranslations('dental')
  const tScopes = useTranslations('admin.dental.scopes')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const initial = () => ({
    code: treatment?.code ?? '',
    name: treatment?.name ?? '',
    symbol: (treatment?.symbol ?? 'FILLING') as DentalSymbol,
    scope: (treatment?.scope ?? 'SURFACE') as DentalScope,
    serviceId: treatment?.serviceId ?? '',
    sortOrder: String(treatment?.sortOrder ?? 0),
    isActive: treatment?.isActive ?? true,
  })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const change = (patch: Partial<ReturnType<typeof initial>>) => {
    setForm((current) => ({ ...current, ...patch }))
    setErrors({})
  }

  function place(details: ReadonlyArray<{ field: string; issue: string }>) {
    const placed: Record<string, string> = {}
    for (const detail of details)
      placed[detail.field.split('.')[0]!] = validationMessage(detail.issue)
    setErrors(placed)
  }

  async function submit() {
    setGeneral(null)
    const parsed = DentalTreatmentInput.safeParse({
      code: form.code,
      name: form.name,
      symbol: form.symbol,
      scope: form.scope,
      serviceId: form.serviceId || null,
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    })
    if (!parsed.success) {
      place(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      return
    }
    setPending(true)
    try {
      await apiFetch(
        treatment ? `/api/v1/dental/treatments/${treatment.id}` : '/api/v1/dental/treatments',
        {
          method: treatment ? 'PUT' : 'POST',
          body: parsed.data,
        },
      )
      setOpen(false)
      router.refresh()
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) place(caught.details)
      else setGeneral(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const fieldError = (field: string) =>
    errors[field] ? <p className="text-danger text-sm">{errors[field]}</p> : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setForm(initial())
          setErrors({})
          setGeneral(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={treatment ? 'ghost' : 'primary'} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{treatment ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {general ? <Alert tone="danger">{general}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-code`}>{t('code')}</Label>
              <Input
                id={`${fieldId}-code`}
                value={form.code}
                maxLength={32}
                className="uppercase"
                aria-invalid={errors.code ? true : undefined}
                onChange={(event) => change({ code: event.target.value })}
              />
              {fieldError('code')}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-name`}>{t('name')}</Label>
              <Input
                id={`${fieldId}-name`}
                value={form.name}
                maxLength={80}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => change({ name: event.target.value })}
              />
              {fieldError('name')}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-symbol`}>{t('symbol')}</Label>
              <Select
                id={`${fieldId}-symbol`}
                value={form.symbol}
                disabled={Boolean(treatment)}
                onChange={(event) => change({ symbol: event.target.value as DentalSymbol })}
              >
                {DENTAL_SYMBOLS.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {tDental(`symbols.${symbol}`)}
                  </option>
                ))}
              </Select>
              {fieldError('symbol')}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-scope`}>{t('scope')}</Label>
              <Select
                id={`${fieldId}-scope`}
                value={form.scope}
                disabled={Boolean(treatment)}
                onChange={(event) => change({ scope: event.target.value as DentalScope })}
              >
                {DENTAL_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {tScopes(scope)}
                  </option>
                ))}
              </Select>
              {fieldError('scope')}
            </div>
          </div>
          {treatment ? <p className="text-muted-foreground text-xs">{t('fixed')}</p> : null}
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-service`}>{t('service')}</Label>
              <Select
                id={`${fieldId}-service`}
                value={form.serviceId}
                onChange={(event) => change({ serviceId: event.target.value })}
              >
                <option value="">{t('noService')}</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
              <p className="text-muted-foreground text-xs">{t('serviceHint')}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-order`}>{t('sortOrder')}</Label>
              <Input
                id={`${fieldId}-order`}
                value={form.sortOrder}
                inputMode="numeric"
                onChange={(event) => change({ sortOrder: event.target.value })}
              />
              {fieldError('sortOrder')}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isActive}
              onChange={(event) => change({ isActive: event.target.checked })}
            />
            {t('active')}
          </label>
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || form.code.trim() === '' || form.name.trim() === ''}
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
