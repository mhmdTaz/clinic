'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  InventoryItemInput,
  type InventoryCategory,
  type InventoryItemDetail,
  type Supplier,
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
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Adding or editing an item (A7). One dialog for both, because the fields are the same and two
 * near-identical forms is how they drift apart.
 *
 * There is no quantity field, deliberately: what an item holds is the ledger's projection, so
 * stock arrives by a receipt and is corrected by an adjustment with a stated reason. A form that
 * let somebody type a new count would be a change nobody could explain afterwards.
 */
export function ItemDialog({
  item,
  categories,
  suppliers,
  currency,
  label,
}: {
  item?: InventoryItemDetail
  categories: InventoryCategory[]
  suppliers: Supplier[]
  currency: string
  label: string
}) {
  const t = useTranslations('inventory.item.form')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState(() => initial(item))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<ReturnType<typeof initial>>) =>
    setValues((current) => ({ ...current, ...patch }))

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const parsed = InventoryItemInput.safeParse({
        sku: values.sku,
        name: values.name,
        description: values.description.trim() === '' ? null : values.description,
        categoryId: values.categoryId || null,
        supplierId: values.supplierId || null,
        unit: values.unit,
        costPrice: values.costPrice.trim() === '' ? null : values.costPrice,
        salePrice: values.salePrice.trim() === '' ? null : values.salePrice,
        reorderLevel: values.reorderLevel.trim() === '' ? '0' : values.reorderLevel,
        isTracked: values.isTracked,
        isBillable: values.isBillable,
        isActive: values.isActive,
      })
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', '')
      await apiFetch(item ? `/api/v1/inventory/items/${item.id}` : '/api/v1/inventory/items', {
        method: item ? 'PUT' : 'POST',
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
          setValues(initial(item))
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={item ? 'ghost' : 'primary'} size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('body', { currency })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-sku`}>{t('sku')}</Label>
              <Input
                id={`${fieldId}-sku`}
                value={values.sku}
                maxLength={40}
                required
                autoFocus
                onChange={(event) => set({ sku: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-unit`}>{t('unit')}</Label>
              <Input
                id={`${fieldId}-unit`}
                value={values.unit}
                maxLength={20}
                required
                placeholder={t('unitHint')}
                onChange={(event) => set({ unit: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-name`}>{t('name')}</Label>
            <Input
              id={`${fieldId}-name`}
              value={values.name}
              maxLength={120}
              required
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-description`}>{t('description')}</Label>
            <Input
              id={`${fieldId}-description`}
              value={values.description}
              maxLength={300}
              onChange={(event) => set({ description: event.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-category`}>{t('category')}</Label>
              <Select
                id={`${fieldId}-category`}
                value={values.categoryId}
                onChange={(event) => set({ categoryId: event.target.value })}
              >
                <option value="">{t('none')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-supplier`}>{t('supplier')}</Label>
              <Select
                id={`${fieldId}-supplier`}
                value={values.supplierId}
                onChange={(event) => set({ supplierId: event.target.value })}
              >
                <option value="">{t('none')}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-cost`}>{t('costPrice')}</Label>
              <Input
                id={`${fieldId}-cost`}
                value={values.costPrice}
                inputMode="decimal"
                onChange={(event) => set({ costPrice: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-sale`}>{t('salePrice')}</Label>
              <Input
                id={`${fieldId}-sale`}
                value={values.salePrice}
                inputMode="decimal"
                onChange={(event) => set({ salePrice: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${fieldId}-reorder`}>{t('reorderLevel')}</Label>
              <Input
                id={`${fieldId}-reorder`}
                value={values.reorderLevel}
                inputMode="decimal"
                onChange={(event) => set({ reorderLevel: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values.isTracked}
                onChange={(event) => set({ isTracked: event.target.checked })}
              />
              {t('tracked')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values.isBillable}
                onChange={(event) => set({ isBillable: event.target.checked })}
              />
              {t('billable')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values.isActive}
                onChange={(event) => set({ isActive: event.target.checked })}
              />
              {t('stocked')}
            </label>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={
              pending ||
              values.sku.trim() === '' ||
              values.name.trim() === '' ||
              values.unit.trim() === ''
            }
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

const initial = (item?: InventoryItemDetail) => ({
  sku: item?.sku ?? '',
  name: item?.name ?? '',
  description: item?.description ?? '',
  categoryId: item?.category?.id ?? '',
  supplierId: item?.supplier?.id ?? '',
  unit: item?.unit ?? '',
  costPrice: item?.costPrice ?? '',
  salePrice: item?.salePrice ?? '',
  reorderLevel: item?.reorderLevel ?? '0',
  isTracked: item?.isTracked ?? true,
  isBillable: item?.isBillable ?? true,
  isActive: item?.isActive ?? true,
})
