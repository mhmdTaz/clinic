'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { DentalScope, TreatmentPlan, TreatmentPlanInput } from '@clinic/contracts'
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
  Textarea,
  type ButtonProps,
} from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { ApiError, apiFetch } from '@/lib/api/client'
import { formatCalendarDate } from '@/lib/format/dates'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { previewLine, previewTotal, usualQuantity } from './plan-money'

/** Planned work on the chart that a plan can take: live, PLANNED, not yet done. */
export interface OpenWork {
  recordId: string
  teeth: string[]
  surfaces: string[]
  treatmentName: string
  scope: DentalScope
  plannedOn: string
  /** The price list's price through the treatment's service; null when it has none. */
  listPrice: string | null
  taxRatePercent: string
}

interface Row {
  included: boolean
  phase: number
  quantity: string
  unitPrice: string
  discount: string
}

const MAX_PHASES = 6

/**
 * Drawing up a plan, or rewriting a draft: a title, up to six phases, and the planned work that
 * goes in each, at the price-list price unless another is typed. The total shown is a preview;
 * the server prices the plan again on save, and a presented plan goes back to draft.
 */
export function PlanEditorDialog({
  patientId,
  plan,
  work,
  currency,
  locale,
  label,
  triggerVariant = 'primary',
}: {
  patientId: string
  plan?: TreatmentPlan
  work: readonly OpenWork[]
  currency: string
  locale: string
  label: string
  triggerVariant?: ButtonProps['variant']
}) {
  const t = useTranslations('dental.plans.editor')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const fieldId = useId()

  const initial = () => {
    const inPlan = new Map(plan?.items.map((item) => [item.toothRecordId, item]) ?? [])
    return {
      title: plan?.title ?? t('defaultTitle'),
      phases: plan?.phases.map((name) => ({ key: crypto.randomUUID(), name })) ?? [
        { key: crypto.randomUUID(), name: t('defaultPhase') },
      ],
      notes: plan?.notes ?? '',
      rows: new Map<string, Row>(
        work.map((entry) => {
          const item = inPlan.get(entry.recordId)
          return [
            entry.recordId,
            {
              included: plan ? Boolean(item) : true,
              phase: item?.phase ?? 0,
              quantity: item?.quantity ?? usualQuantity(entry.scope, entry.teeth.length),
              // A price that differs from the list was typed on purpose; keep it visible.
              unitPrice: item && item.unitPrice !== entry.listPrice ? item.unitPrice : '',
              discount: item && item.discount !== '0' ? item.discount : '',
            },
          ]
        }),
      ),
    }
  }

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const setRow = (recordId: string, patch: Partial<Row>) => {
    setForm((current) => {
      const rows = new Map(current.rows)
      rows.set(recordId, { ...rows.get(recordId)!, ...patch })
      return { ...current, rows }
    })
    setErrors({})
  }

  const chosen = work.filter((entry) => form.rows.get(entry.recordId)?.included)
  const lineOf = (entry: OpenWork) => {
    const row = form.rows.get(entry.recordId)!
    return {
      quantity: row.quantity,
      unitPrice: row.unitPrice || entry.listPrice || '0',
      discount: row.discount || '0',
      taxRatePercent: entry.taxRatePercent,
    }
  }
  const total = previewTotal(chosen.map(lineOf), currency)

  function removePhase(index: number) {
    setForm((current) => {
      const rows = new Map(current.rows)
      // Work in a removed phase moves to the one before it; later phases shift down.
      for (const [id, row] of rows) {
        if (row.phase === index) rows.set(id, { ...row, phase: Math.max(0, index - 1) })
        else if (row.phase > index) rows.set(id, { ...row, phase: row.phase - 1 })
      }
      return { ...current, phases: current.phases.filter((_, i) => i !== index), rows }
    })
  }

  async function submit() {
    setGeneral(null)
    const body: TreatmentPlanInput = {
      title: form.title.trim(),
      phases: form.phases.map((phase) => ({ name: phase.name.trim() })),
      items: chosen.map((entry) => {
        const row = form.rows.get(entry.recordId)!
        return {
          toothRecordId: entry.recordId,
          phase: row.phase,
          quantity: row.quantity.trim() || null,
          unitPrice: row.unitPrice.trim() || null,
          discount: row.discount.trim() || '0',
        }
      }),
      notes: form.notes.trim() || null,
    }
    setPending(true)
    try {
      await apiFetch(
        plan
          ? `/api/v1/treatment-plans/${plan.id}`
          : `/api/v1/patients/${patientId}/treatment-plans`,
        { method: plan ? 'PUT' : 'POST', body },
      )
      setOpen(false)
      router.refresh()
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        const placed: Record<string, string> = {}
        for (const detail of caught.details) {
          // `items.2.unitPrice` names the third chosen row; show it against that row's record.
          const match = /^items\.(\d+)\.(\w+)/.exec(detail.field)
          const entry = match ? chosen[Number(match[1])] : undefined
          const key = entry ? `${entry.recordId}.${match![2]}` : detail.field.split('.')[0]!
          placed[key] = validationMessage(detail.issue)
        }
        setErrors(placed)
      } else {
        setGeneral(errorMessage(caught))
      }
    } finally {
      setPending(false)
    }
  }

  const rowError = (recordId: string) =>
    ['toothRecordId', 'phase', 'quantity', 'unitPrice', 'discount']
      .map((field) => errors[`${recordId}.${field}`])
      .filter(Boolean)
      .join(' ')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (next) {
          setForm(initial())
          setErrors({})
          setGeneral(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{plan ? t('editTitle') : t('newTitle')}</DialogTitle>
          <DialogDescription>
            {plan && plan.status === 'PRESENTED' ? t('backToDraft') : t('body')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pe-1">
          {general ? <Alert tone="danger">{general}</Alert> : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-title`}>{t('title')}</Label>
            <Input
              id={`${fieldId}-title`}
              value={form.title}
              maxLength={120}
              onChange={(event) => setForm((c) => ({ ...c, title: event.target.value }))}
            />
            {errors.title ? <p className="text-danger text-sm">{errors.title}</p> : null}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('phases')}</legend>
            {form.phases.map((phase, index) => (
              <div key={phase.key} className="flex items-center gap-2">
                <span className="text-muted-foreground w-6 text-sm tabular-nums">{index + 1}.</span>
                <Input
                  aria-label={t('phaseName', { number: index + 1 })}
                  value={phase.name}
                  maxLength={60}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      phases: c.phases.map((p, i) =>
                        i === index ? { ...p, name: event.target.value } : p,
                      ),
                    }))
                  }
                />
                {form.phases.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('removePhase', { number: index + 1 })}
                    onClick={() => removePhase(index)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
            {form.phases.length < MAX_PHASES ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  setForm((c) => ({
                    ...c,
                    phases: [
                      ...c.phases,
                      {
                        key: crypto.randomUUID(),
                        name: t('phaseN', { number: c.phases.length + 1 }),
                      },
                    ],
                  }))
                }
              >
                <Plus aria-hidden="true" className="size-4" />
                {t('addPhase')}
              </Button>
            ) : null}
            {errors.phases ? <p className="text-danger text-sm">{errors.phases}</p> : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('work')}</legend>
            {work.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('noWork')}</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {work.map((entry) => {
                  const row = form.rows.get(entry.recordId)!
                  const line = previewLine(lineOf(entry), currency)
                  const problem = rowError(entry.recordId)
                  const name = `${entry.treatmentName}${entry.surfaces.length ? ` (${entry.surfaces.join('')})` : ''} — ${entry.teeth.join(', ')}`
                  return (
                    <li key={entry.recordId} className="flex flex-col gap-2 p-3">
                      <label className="flex items-start gap-2 text-sm">
                        <Checkbox
                          checked={row.included}
                          onChange={(event) =>
                            setRow(entry.recordId, { included: event.target.checked })
                          }
                        />
                        <span className="flex-1">
                          <span className="font-medium">{name}</span>
                          {entry.plannedOn ? (
                            <span className="text-muted-foreground block text-xs">
                              {t('plannedOn', {
                                date: formatCalendarDate(entry.plannedOn, locale),
                              })}
                            </span>
                          ) : null}
                        </span>
                        {row.included && line ? (
                          <Money amount={line} currency={currency} locale={locale} />
                        ) : null}
                      </label>
                      {row.included ? (
                        <div className="grid grid-cols-2 gap-2 ps-7 sm:grid-cols-4">
                          <div className="flex flex-col gap-1">
                            <Label
                              className="text-xs"
                              htmlFor={`${fieldId}-${entry.recordId}-phase`}
                            >
                              {t('phase')}
                            </Label>
                            <Select
                              id={`${fieldId}-${entry.recordId}-phase`}
                              value={String(row.phase)}
                              onChange={(event) =>
                                setRow(entry.recordId, { phase: Number(event.target.value) })
                              }
                            >
                              {form.phases.map((phase, index) => (
                                <option key={phase.key} value={index}>
                                  {index + 1}. {phase.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label className="text-xs" htmlFor={`${fieldId}-${entry.recordId}-qty`}>
                              {t('quantity')}
                            </Label>
                            <Input
                              id={`${fieldId}-${entry.recordId}-qty`}
                              inputMode="decimal"
                              value={row.quantity}
                              onChange={(event) =>
                                setRow(entry.recordId, { quantity: event.target.value })
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label
                              className="text-xs"
                              htmlFor={`${fieldId}-${entry.recordId}-price`}
                            >
                              {t('unitPrice')}
                            </Label>
                            <Input
                              id={`${fieldId}-${entry.recordId}-price`}
                              inputMode="decimal"
                              placeholder={entry.listPrice ?? t('noListPrice')}
                              value={row.unitPrice}
                              onChange={(event) =>
                                setRow(entry.recordId, { unitPrice: event.target.value })
                              }
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <Label
                              className="text-xs"
                              htmlFor={`${fieldId}-${entry.recordId}-discount`}
                            >
                              {t('discount')}
                            </Label>
                            <Input
                              id={`${fieldId}-${entry.recordId}-discount`}
                              inputMode="decimal"
                              placeholder="0"
                              value={row.discount}
                              onChange={(event) =>
                                setRow(entry.recordId, { discount: event.target.value })
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                      {problem ? <p className="text-danger ps-7 text-sm">{problem}</p> : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {errors.items ? <p className="text-danger text-sm">{errors.items}</p> : null}
          </fieldset>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-notes`}>{t('notes')}</Label>
            <Textarea
              id={`${fieldId}-notes`}
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))}
            />
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-sm">
            {t('total')} <Money amount={total} currency={currency} locale={locale} tone="strong" />
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || chosen.length === 0 || form.title.trim() === ''}
              onClick={() => void submit()}
            >
              {pending ? <Spinner className="size-4" /> : null}
              {t('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
