'use client'

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  UpdateInvoiceRequest,
  addAmounts,
  isNegativeAmount,
  multiplyAmount,
  percentOf,
  subtractAmounts,
  type InvoiceDetail,
  type Service,
} from '@clinic/contracts'
import { Alert, Button, Input, Label, Select, Spinner } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { Money } from './money'

interface Draft {
  key: string
  serviceId: string
  description: string
  quantity: string
  unitPrice: string
  discount: string
  taxRatePercent: string
}

const blank = (): Draft => ({
  key: crypto.randomUUID(),
  serviceId: '',
  description: '',
  quantity: '1',
  unitPrice: '',
  discount: '0',
  taxRatePercent: '0',
})

/**
 * Editing a draft invoice (S7).
 *
 * The running totals are computed with the **same exact arithmetic the server uses** — the money
 * functions live in `@clinic/contracts` precisely so both sides can import them (section 9.2).
 * A preview that disagreed with the saved invoice by a cent would be found at the till, by a
 * patient, which is the worst possible place to find it.
 */
export function InvoiceLinesEditor({
  invoice,
  services,
  locale,
}: {
  invoice: InvoiceDetail
  services: Service[]
  locale: string
}) {
  const t = useTranslations('billing.invoice')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const [lines, setLines] = useState<Draft[]>(() =>
    invoice.lines.length === 0
      ? [blank()]
      : invoice.lines.map((line) => ({
          key: line.id,
          serviceId: line.serviceId ?? '',
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          taxRatePercent: line.taxRatePercent,
        })),
  )
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currency = invoice.currency
  const totals = useMemo(() => summarise(lines, currency), [lines, currency])

  const update = (key: string, patch: Partial<Draft>) => {
    setSaved(false)
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  /** Choosing a service snapshots its price and tax onto the line; both stay editable. */
  const chooseService = (key: string, serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId)
    update(key, {
      serviceId,
      ...(service
        ? {
            description: service.name,
            unitPrice: service.price,
            taxRatePercent: service.taxRatePercent,
          }
        : {}),
    })
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const parsed = UpdateInvoiceRequest.safeParse({
        lines: lines.map((line) => ({
          serviceId: line.serviceId || null,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount || '0',
          taxRatePercent: line.taxRatePercent || '0',
        })),
        notes: notes.trim() === '' ? null : notes,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/billing/invoices/${invoice.id}`, {
        method: 'PATCH',
        body: parsed.data,
      })
      setSaved(true)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {lines.map((line, index) => (
          <li key={line.key} className="border-border flex flex-col gap-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor={`service-${line.key}`}>{t('fields.service')}</Label>
                <Select
                  id={`service-${line.key}`}
                  value={line.serviceId}
                  onChange={(event) => chooseService(line.key, event.target.value)}
                >
                  <option value="">{t('fields.custom')}</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor={`description-${line.key}`}>{t('fields.description')}</Label>
                <Input
                  id={`description-${line.key}`}
                  value={line.description}
                  maxLength={200}
                  required
                  onChange={(event) => update(line.key, { description: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`quantity-${line.key}`}>{t('fields.quantity')}</Label>
                <Input
                  id={`quantity-${line.key}`}
                  value={line.quantity}
                  inputMode="decimal"
                  onChange={(event) => update(line.key, { quantity: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`unitPrice-${line.key}`}>{t('fields.unitPrice')}</Label>
                <Input
                  id={`unitPrice-${line.key}`}
                  value={line.unitPrice}
                  inputMode="decimal"
                  onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`discount-${line.key}`}>{t('fields.discount')}</Label>
                <Input
                  id={`discount-${line.key}`}
                  value={line.discount}
                  inputMode="decimal"
                  onChange={(event) => update(line.key, { discount: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`tax-${line.key}`}>{t('fields.taxRate')}</Label>
                <Input
                  id={`tax-${line.key}`}
                  value={line.taxRatePercent}
                  inputMode="decimal"
                  onChange={(event) => update(line.key, { taxRatePercent: event.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-sm">
                {t('lineTotal')}{' '}
                <Money
                  amount={totals.lines[index] ?? '0'}
                  currency={currency}
                  locale={locale}
                  tone="strong"
                />
              </span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={lines.length === 1}
                onClick={() => {
                  setSaved(false)
                  setLines((current) => current.filter((candidate) => candidate.key !== line.key))
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('actions.removeLine')}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={() => {
          setSaved(false)
          setLines((current) => [...current, blank()])
        }}
      >
        {t('actions.addLine')}
      </Button>

      <div className="flex flex-col gap-1">
        <Label htmlFor="invoice-notes">{t('fields.notes')}</Label>
        <Input
          id="invoice-notes"
          value={notes}
          maxLength={500}
          onChange={(event) => {
            setSaved(false)
            setNotes(event.target.value)
          }}
        />
      </div>

      <dl className="border-border flex flex-col gap-1 border-t pt-3 text-sm">
        <Row label={t('totals.subtotal')}>
          <Money amount={totals.subtotal} currency={currency} locale={locale} />
        </Row>
        <Row label={t('totals.discount')}>
          <Money amount={totals.discountTotal} currency={currency} locale={locale} />
        </Row>
        <Row label={t('totals.tax')}>
          <Money amount={totals.taxTotal} currency={currency} locale={locale} />
        </Row>
        <Row label={t('totals.total')}>
          <Money amount={totals.total} currency={currency} locale={locale} tone="strong" />
        </Row>
      </dl>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved && !error ? <Alert tone="success">{t('saved')}</Alert> : null}

      <div className="flex justify-end">
        <Button type="button" disabled={pending} onClick={() => void save()}>
          {pending ? <Spinner className="size-4" /> : null}
          {t('actions.save')}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * The same order of operations as the server's `computeTotals`: multiply, discount, tax, round
 * once per line, then sum the rounded lines (ADR-0027). A malformed figure mid-typing simply
 * contributes zero rather than throwing the preview away.
 */
function summarise(lines: Draft[], currency: string) {
  const computed = lines.map((line) => {
    try {
      const gross = multiplyAmount(currency, line.unitPrice || '0', line.quantity || '0')
      const net = subtractAmounts(currency, gross, line.discount || '0')
      if (isNegativeAmount(net)) return null
      const tax = percentOf(currency, net, line.taxRatePercent || '0')
      return { gross, discount: line.discount || '0', net, tax }
    } catch {
      return null
    }
  })

  const present = computed.filter((line): line is NonNullable<typeof line> => line !== null)
  const subtotal = addAmounts(currency, ...present.map((line) => line.gross))
  const discountTotal = addAmounts(currency, ...present.map((line) => line.discount))
  const taxTotal = addAmounts(currency, ...present.map((line) => line.tax))

  return {
    lines: computed.map((line) =>
      line ? addAmounts(currency, line.net, line.tax) : addAmounts(currency),
    ),
    subtotal,
    discountTotal,
    taxTotal,
    total: addAmounts(currency, subtractAmounts(currency, subtotal, discountTotal), taxTotal),
  }
}
