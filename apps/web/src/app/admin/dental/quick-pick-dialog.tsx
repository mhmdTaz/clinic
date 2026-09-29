'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  QuickPickInput,
  issueCode,
  issuePath,
  type DentalScope,
  type DentalSymbol,
  type QuickPick,
  type ToothRecordStatus,
  type ToothSurface,
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
import { statusesFor } from '@/components/dental/tooth-panel'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

interface TreatmentOption {
  id: string
  name: string
  symbol: DentalSymbol
  scope: DentalScope
  isActive: boolean
}

interface Row {
  key: number
  treatmentId: string
  surfaces: ToothSurface[]
  status: ToothRecordStatus
}

const SURFACES: ToothSurface[] = ['M', 'D', 'O', 'I', 'B', 'L']
let sequence = 0

/**
 * A one-tap preset: what it charts, on which surfaces, with what status. It is applied to the tooth
 * the front desk has selected, and every row is checked against that tooth when it is — an
 * occlusal filling offered on a front tooth is refused then, with the reason.
 */
export function QuickPickDialog({
  pick,
  treatments,
  label,
}: {
  pick?: QuickPick
  treatments: readonly TreatmentOption[]
  label: string
}) {
  const t = useTranslations('admin.dental.quickPickForm')
  const tDental = useTranslations('dental')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()
  const offered = treatments.filter(
    (treatment) =>
      treatment.isActive || pick?.items.some((item) => item.treatmentId === treatment.id),
  )
  const byId = new Map(treatments.map((treatment) => [treatment.id, treatment]))

  const initialRows = (): Row[] =>
    pick
      ? pick.items.map((item) => ({ key: (sequence += 1), ...item, surfaces: [...item.surfaces] }))
      : [newRow()]
  function newRow(): Row {
    const first = offered[0]
    return {
      key: (sequence += 1),
      treatmentId: first?.id ?? '',
      surfaces: [],
      status: first ? statusesFor(first.symbol)[0]! : 'COMPLETED',
    }
  }

  const [open, setOpen] = useState(false)
  const [name, setName] = useState(pick?.name ?? '')
  const [rows, setRows] = useState<Row[]>(initialRows)
  const [sortOrder, setSortOrder] = useState(String(pick?.sortOrder ?? 0))
  const [isActive, setIsActive] = useState(pick?.isActive ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const change = (key: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
    setErrors({})
  }

  function place(details: ReadonlyArray<{ field: string; issue: string }>) {
    const placed: Record<string, string> = {}
    for (const detail of details) {
      const [head, index] = detail.field.split('.')
      placed[head === 'items' && index !== undefined ? `items.${index}` : head!] =
        validationMessage(detail.issue)
    }
    setErrors(placed)
  }

  async function submit() {
    setGeneral(null)
    const parsed = QuickPickInput.safeParse({
      name,
      items: rows.map((row) => ({
        treatmentId: row.treatmentId,
        surfaces: byId.get(row.treatmentId)?.scope === 'SURFACE' ? row.surfaces : [],
        status: row.status,
      })),
      sortOrder: Number(sortOrder) || 0,
      isActive,
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
        pick ? `/api/v1/dental/quick-picks/${pick.id}` : '/api/v1/dental/quick-picks',
        {
          method: pick ? 'PUT' : 'POST',
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setName(pick?.name ?? '')
          setRows(initialRows())
          setSortOrder(String(pick?.sortOrder ?? 0))
          setIsActive(pick?.isActive ?? true)
          setErrors({})
          setGeneral(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={pick ? 'ghost' : 'primary'} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pick ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {general ? <Alert tone="danger">{general}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-name`}>{t('name')}</Label>
              <Input
                id={`${fieldId}-name`}
                value={name}
                maxLength={60}
                placeholder={t('namePlaceholder')}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value)
                  setErrors({})
                }}
              />
              {errors.name ? <p className="text-danger text-sm">{errors.name}</p> : null}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-order`}>{t('sortOrder')}</Label>
              <Input
                id={`${fieldId}-order`}
                value={sortOrder}
                inputMode="numeric"
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('items')}</legend>
            {rows.map((row, index) => {
              const treatment = byId.get(row.treatmentId)
              return (
                <div key={row.key} className="flex flex-col gap-2 rounded-md border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={t('treatmentFor', { number: index + 1 })}
                      value={row.treatmentId}
                      className="min-w-48 flex-1"
                      onChange={(event) => {
                        const next = byId.get(event.target.value)
                        change(row.key, {
                          treatmentId: event.target.value,
                          surfaces: [],
                          status: next ? statusesFor(next.symbol)[0]! : row.status,
                        })
                      }}
                    >
                      {offered.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={t('statusFor', { number: index + 1 })}
                      value={row.status}
                      className="w-40"
                      onChange={(event) =>
                        change(row.key, { status: event.target.value as ToothRecordStatus })
                      }
                    >
                      {(treatment ? statusesFor(treatment.symbol) : []).map((status) => (
                        <option key={status} value={status}>
                          {tDental(`statuses.${status}`)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={rows.length === 1}
                      aria-label={t('remove', { number: index + 1 })}
                      onClick={() =>
                        setRows((current) => current.filter((item) => item.key !== row.key))
                      }
                    >
                      <X aria-hidden="true" size={16} />
                    </Button>
                  </div>
                  {treatment?.scope === 'SURFACE' ? (
                    <div
                      className="flex flex-wrap gap-1"
                      role="group"
                      aria-label={t('surfacesFor', { number: index + 1 })}
                    >
                      {SURFACES.map((surface) => {
                        const on = row.surfaces.includes(surface)
                        return (
                          <Button
                            key={surface}
                            type="button"
                            size="sm"
                            variant={on ? 'primary' : 'outline'}
                            aria-pressed={on}
                            title={tDental(`surfaces.${surface}`)}
                            className="w-11 px-0"
                            onClick={() =>
                              change(row.key, {
                                surfaces: on
                                  ? row.surfaces.filter((item) => item !== surface)
                                  : [...row.surfaces, surface],
                              })
                            }
                          >
                            {surface}
                          </Button>
                        )
                      })}
                    </div>
                  ) : null}
                  {errors[`items.${index}`] ? (
                    <p className="text-danger text-sm">{errors[`items.${index}`]}</p>
                  ) : null}
                </div>
              )
            })}
            {errors.items ? <p className="text-danger text-sm">{errors.items}</p> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={rows.length >= 10 || offered.length === 0}
              onClick={() => setRows((current) => [...current, newRow()])}
            >
              {t('addItem')}
            </Button>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            {t('active')}
          </label>
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || name.trim() === ''}
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
