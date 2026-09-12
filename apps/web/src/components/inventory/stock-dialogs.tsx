'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AdjustStockRequest,
  ReceiveStockRequest,
  displayQuantity,
  type InventoryItemDetail,
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

/**
 * Stock arriving (S10). One delivery is one batch: its number and expiry travel with it, because
 * FEFO can only reach for the box that expires soonest if it knows when each box expires.
 */
export function ReceiveStockDialog({
  item,
  label,
  today,
}: {
  item: InventoryItemDetail
  label: string
  today: string
}) {
  const t = useTranslations('inventory.receive')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [costPrice, setCostPrice] = useState(item.costPrice ?? '')
  const [reference, setReference] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = ReceiveStockRequest.safeParse({
        quantity,
        batchNumber: batchNumber.trim() === '' ? null : batchNumber,
        expiresAt: expiresAt === '' ? null : expiresAt,
        costPrice: costPrice.trim() === '' ? null : costPrice,
        supplierId: item.supplier?.id ?? null,
        reference: reference.trim() === '' ? null : reference,
        note: null,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/inventory/items/${item.id}/receive`, {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuantity('')
          setBatchNumber('')
          setExpiresAt('')
          setCostPrice(item.costPrice ?? '')
          setReference('')
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
          <DialogDescription>{t('body', { name: item.name })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-quantity`}>{t('quantity', { unit: item.unit })}</Label>
              <Input
                id={`${fieldId}-quantity`}
                value={quantity}
                inputMode="decimal"
                required
                autoFocus
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-cost`}>{t('costPrice')}</Label>
              <Input
                id={`${fieldId}-cost`}
                value={costPrice}
                inputMode="decimal"
                onChange={(event) => setCostPrice(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-batch`}>{t('batchNumber')}</Label>
              <Input
                id={`${fieldId}-batch`}
                value={batchNumber}
                maxLength={60}
                onChange={(event) => setBatchNumber(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-expiry`}>{t('expiresAt')}</Label>
              <Input
                id={`${fieldId}-expiry`}
                type="date"
                value={expiresAt}
                min={today}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reference`}>{t('reference')}</Label>
            <Input
              id={`${fieldId}-reference`}
              value={reference}
              maxLength={120}
              onChange={(event) => setReference(event.target.value)}
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
            disabled={pending || quantity.trim() === ''}
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

/**
 * Correcting a count, writing stock off, or taking it back (S10).
 *
 * A reason is required on every one of them, because a stock level that changed for no stated
 * cause is exactly what a stock-take cannot explain. Wastage and returns have a fixed direction;
 * only a recount can go either way, which is why the sign field appears only for an adjustment.
 */
export function AdjustStockDialog({ item, label }: { item: InventoryItemDetail; label: string }) {
  const t = useTranslations('inventory.adjust')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [type, setType] = useState<'ADJUSTMENT' | 'WASTAGE' | 'RETURN'>('ADJUSTMENT')
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const magnitude = quantity.trim().replace('-', '')
      const parsed = AdjustStockRequest.safeParse({
        type,
        quantity: type === 'ADJUSTMENT' && direction === 'OUT' ? `-${magnitude}` : magnitude,
        batchId: null,
        reason,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(`/api/v1/inventory/items/${item.id}/adjust`, {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setType('ADJUSTMENT')
          setDirection('OUT')
          setQuantity('')
          setReason('')
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('body', {
              name: item.name,
              quantity: displayQuantity(item.quantityOnHand),
              unit: item.unit,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-type`}>{t('type')}</Label>
            <Select
              id={`${fieldId}-type`}
              value={type}
              onChange={(event) =>
                setType(event.target.value as 'ADJUSTMENT' | 'WASTAGE' | 'RETURN')
              }
            >
              <option value="ADJUSTMENT">{t('types.ADJUSTMENT')}</option>
              <option value="WASTAGE">{t('types.WASTAGE')}</option>
              <option value="RETURN">{t('types.RETURN')}</option>
            </Select>
          </div>

          {type === 'ADJUSTMENT' ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-direction`}>{t('direction')}</Label>
              <Select
                id={`${fieldId}-direction`}
                value={direction}
                onChange={(event) => setDirection(event.target.value as 'IN' | 'OUT')}
              >
                <option value="OUT">{t('directions.OUT')}</option>
                <option value="IN">{t('directions.IN')}</option>
              </Select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-quantity`}>{t('quantity', { unit: item.unit })}</Label>
            <Input
              id={`${fieldId}-quantity`}
              value={quantity}
              inputMode="decimal"
              required
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-reason`}>{t('reason')}</Label>
            <Input
              id={`${fieldId}-reason`}
              value={reason}
              maxLength={300}
              required
              onChange={(event) => setReason(event.target.value)}
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
            disabled={pending || quantity.trim() === '' || reason.trim() === ''}
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
