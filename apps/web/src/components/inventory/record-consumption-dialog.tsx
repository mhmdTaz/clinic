'use client'

import { useId, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  RecordConsumptionRequest,
  displayQuantity,
  type ConsumptionResult,
  type InventoryItemSummary,
} from '@clinic/contracts'
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
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

interface Row {
  key: string
  itemId: string
  quantity: string
  note: string
}

const blank = (): Row => ({ key: crypto.randomUUID(), itemId: '', quantity: '1', note: '' })

/**
 * Recording what a visit used (D15).
 *
 * The list offers what is actually usable: retired items are gone, and anything whose remaining
 * stock has all expired is marked, because choosing it would only earn a refusal. The server
 * checks all of it again — this is a courtesy, not the guard.
 */
export function RecordConsumptionDialog({
  encounterId,
  items,
  label,
}: {
  encounterId: string
  items: InventoryItemSummary[]
  label: string
}) {
  const t = useTranslations('inventory.consume')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([blank()])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = RecordConsumptionRequest.safeParse({
        items: rows
          .filter((row) => row.itemId !== '')
          .map((row) => ({
            itemId: row.itemId,
            quantity: row.quantity,
            batchId: null,
            note: row.note.trim() === '' ? null : row.note,
          })),
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch<ConsumptionResult>(`/api/v1/encounters/${encounterId}/consumption`, {
        method: 'POST',
        body: parsed.data,
      })
      setOpen(false)
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const chosen = rows.filter((row) => row.itemId !== '')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setRows([blank()])
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

        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const item = items.find((candidate) => candidate.id === row.itemId)
            return (
              <li key={row.key} className="border-border flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${fieldId}-item-${row.key}`}>{t('item')}</Label>
                  <Select
                    id={`${fieldId}-item-${row.key}`}
                    value={row.itemId}
                    onChange={(event) => update(row.key, { itemId: event.target.value })}
                  >
                    <option value="">{t('choose')}</option>
                    {items.map((candidate) => (
                      <option
                        key={candidate.id}
                        value={candidate.id}
                        disabled={candidate.isTracked && candidate.quantityOnHand === '0.000'}
                      >
                        {candidate.name}
                        {candidate.isTracked
                          ? ` — ${displayQuantity(candidate.quantityOnHand)} ${candidate.unit}`
                          : ''}
                        {candidate.hasExpired ? ` (${t('expired')})` : ''}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${fieldId}-qty-${row.key}`}>
                      {item ? t('quantityIn', { unit: item.unit }) : t('quantity')}
                    </Label>
                    <Input
                      id={`${fieldId}-qty-${row.key}`}
                      value={row.quantity}
                      inputMode="decimal"
                      onChange={(event) => update(row.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${fieldId}-note-${row.key}`}>{t('note')}</Label>
                    <Input
                      id={`${fieldId}-note-${row.key}`}
                      value={row.note}
                      maxLength={200}
                      onChange={(event) => update(row.key, { note: event.target.value })}
                    />
                  </div>
                </div>
                {item && !item.isBillable ? (
                  <p className="text-muted-foreground text-xs">{t('notBilled')}</p>
                ) : null}
                {rows.length > 1 ? (
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((candidate) => candidate.key !== row.key),
                        )
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('remove')}
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>

        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => setRows((current) => [...current, blank()])}
        >
          {t('addAnother')}
        </Button>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || chosen.length === 0}
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
