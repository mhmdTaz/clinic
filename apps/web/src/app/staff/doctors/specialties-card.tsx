'use client'

import { useId, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { UpdateSpecialtyRequest, type Specialty } from '@clinic/contracts'
import {
  Alert,
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
  Input,
  Label,
  Spinner,
} from '@clinic/ui'
import { AutoForm } from '@/components/forms/auto-form'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/** The specialty vocabulary: added, renamed and retired here, never deleted (section 8.3). */
export function SpecialtiesCard({
  specialties,
  canManage,
}: {
  specialties: Specialty[]
  canManage: boolean
}) {
  const t = useTranslations('staff.doctors.specialties')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const inputId = useId()
  const [name, setName] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldError(null)
    setError(null)
    if (name.trim() === '') {
      setFieldError(validationMessage('REQUIRED'))
      return
    }
    setPending('add')
    try {
      await apiFetch('/api/v1/specialties', { method: 'POST', body: { name } })
      setName('')
      router.refresh()
    } catch (caught) {
      const onName =
        caught instanceof ApiError
          ? caught.details.find((detail) => detail.field === 'name')
          : undefined
      if (onName) setFieldError(validationMessage(onName.issue))
      else setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  async function setActive(specialty: Specialty, isActive: boolean) {
    setPending(specialty.id)
    setError(null)
    try {
      await apiFetch(`/api/v1/specialties/${specialty.id}`, {
        method: 'PUT',
        body: { name: specialty.name, isActive },
      })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {specialties.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {specialties.map((specialty) => (
              <li
                key={specialty.id}
                className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className={
                      specialty.isActive ? 'font-medium' : 'text-muted-foreground font-medium'
                    }
                  >
                    {specialty.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('doctors', { count: specialty.doctorCount })}
                  </span>
                  {specialty.isActive ? null : <Badge tone="neutral">{t('retired')}</Badge>}
                </p>
                {canManage ? (
                  <div className="flex gap-2">
                    <RenameDialog specialty={specialty} />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending !== null}
                      title={specialty.isActive ? t('retireHint') : undefined}
                      onClick={() => void setActive(specialty, !specialty.isActive)}
                    >
                      {pending === specialty.id ? <Spinner /> : null}
                      {specialty.isActive ? t('retire') : t('reinstate')}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <form
            onSubmit={add}
            noValidate
            className="border-border flex flex-col gap-2 border-t pt-4"
          >
            <Label htmlFor={inputId}>{t('newName')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={inputId}
                value={name}
                maxLength={60}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${inputId}-error` : undefined}
                onChange={(event) => setName(event.target.value)}
                className="sm:max-w-sm"
              />
              <Button type="submit" disabled={pending !== null} className="self-start">
                {pending === 'add' ? <Spinner /> : null}
                {t('add')}
              </Button>
            </div>
            {fieldError ? (
              <p id={`${inputId}-error`} className="text-danger text-xs font-medium">
                {fieldError}
              </p>
            ) : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}

function RenameDialog({ specialty }: { specialty: Specialty }) {
  const t = useTranslations('staff.doctors.specialties')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('rename', { name: specialty.name })}>
          {tCommon('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('renameTitle', { name: specialty.name })}</DialogTitle>
          <DialogDescription>{t('retireHint')}</DialogDescription>
        </DialogHeader>
        <AutoForm
          schema={UpdateSpecialtyRequest}
          sections={[
            {
              id: 'specialty',
              fields: [
                {
                  name: 'name',
                  label: t('name'),
                  kind: 'text',
                  required: true,
                  maxLength: 60,
                  span: 2,
                },
              ],
            },
          ]}
          initialValues={specialty}
          action={`/api/v1/specialties/${specialty.id}`}
          method="PUT"
          submitLabel={tCommon('save')}
          beforeSubmit={async (body) => ({ ...(body as object), isActive: specialty.isActive })}
          onSuccess={() => {
            setOpen(false)
            router.refresh()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
