'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BranchInput, UpdateBranchRequest, type BranchDetail } from '@clinic/contracts'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@clinic/ui'
import { AutoForm, type AutoFormSection } from '@/components/forms/auto-form'
import { useRouter } from '@/lib/navigation/use-router'

/** ADR-0021: the list always shows, so a single-site clinic can see how to add a second. */
export function LocationsCard({
  branches,
  canManage,
}: {
  branches: BranchDetail[]
  canManage: boolean
}) {
  const t = useTranslations('admin.clinic.locations')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </div>
          {canManage ? <BranchDialog /> : null}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="divide-border flex flex-col divide-y">
          {branches.map((branch) => (
            <li
              key={branch.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {branch.name}
                  <Badge tone={branch.isActive ? 'success' : 'neutral'}>
                    {branch.isActive ? t('open') : t('closedBadge')}
                  </Badge>
                </p>
                {branch.phone || branch.address ? (
                  <p className="text-muted-foreground text-sm break-words">
                    {[branch.phone, branch.address].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
              </div>
              {canManage ? <BranchDialog branch={branch} /> : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function BranchDialog({ branch }: { branch?: BranchDetail }) {
  const t = useTranslations('admin.clinic.locations')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const sections: AutoFormSection[] = [
    {
      id: 'branch',
      fields: [
        { name: 'name', label: t('name'), kind: 'text', required: true, maxLength: 80, span: 2 },
        { name: 'phone', label: t('phone'), kind: 'tel', maxLength: 32 },
        { name: 'address', label: t('address'), kind: 'text', maxLength: 200 },
        ...(branch
          ? [
              {
                name: 'isActive',
                label: t('isActive'),
                kind: 'checkbox' as const,
                hint: t('isActiveHint'),
                span: 2 as const,
              },
            ]
          : []),
      ],
    },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {branch ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            aria-label={t('editTitle', { name: branch.name })}
          >
            {tCommon('edit')}
          </Button>
        ) : (
          <Button size="sm" className="self-start">
            {t('add')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {branch ? t('editTitle', { name: branch.name }) : t('addTitle')}
          </DialogTitle>
          {branch ? null : <DialogDescription>{t('addBody')}</DialogDescription>}
        </DialogHeader>
        <AutoForm
          schema={branch ? UpdateBranchRequest : BranchInput}
          sections={sections}
          initialValues={branch ?? {}}
          action={branch ? `/api/v1/admin/branches/${branch.id}` : '/api/v1/admin/branches'}
          method={branch ? 'PUT' : 'POST'}
          submitLabel={branch ? tCommon('save') : t('add')}
          onSuccess={() => {
            setOpen(false)
            router.refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
