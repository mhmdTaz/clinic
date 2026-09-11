'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'

const EDITABLE_SCOPES = ['OWN', 'ASSIGNED', 'CLINIC'] as const
type EditableScope = (typeof EDITABLE_SCOPES)[number]
const RANK: Record<string, number> = { OWN: 1, ASSIGNED: 2, CLINIC: 3, GLOBAL: 4 }

export interface MatrixPermission {
  key: string
  label: string
  scopable: boolean
  dangerous: boolean
  phi: boolean
  /** The widest reach the editor may grant; null when they may not grant it at all. */
  maxScope: 'OWN' | 'ASSIGNED' | 'CLINIC' | null
}

export interface MatrixGroup {
  id: string
  label: string
  permissions: MatrixPermission[]
}

/**
 * The permission matrix (A4). It renders straight from the catalogue, so a new permission appears
 * here with no second list to maintain (section 7.2). The server enforces the same rules this
 * screen shows; the greyed rows are a courtesy, not the control.
 */
export function PermissionMatrix({
  roleId,
  groups,
  granted,
  readOnly,
}: {
  roleId: string
  groups: MatrixGroup[]
  granted: Array<{ key: string; scope: string }>
  readOnly: boolean
}) {
  const t = useTranslations('admin.roles.detail')
  const tScopes = useTranslations('scopes')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const baseId = useId()

  const grantedKey = JSON.stringify(granted)
  const stored = useMemo(
    () =>
      new Map((JSON.parse(grantedKey) as typeof granted).map((grant) => [grant.key, grant.scope])),
    [grantedKey],
  )
  const [grants, setGrants] = useState<Map<string, string>>(() => new Map(stored))
  const [confirming, setConfirming] = useState<MatrixPermission | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  const changes = useMemo(() => {
    const keys = new Set([...stored.keys(), ...grants.keys()])
    return [...keys].filter((key) => stored.get(key) !== grants.get(key)).length
  }, [stored, grants])

  // Saved grants coming back from the server replace the local copy — unless edits are pending.
  const changesRef = useRef(changes)
  changesRef.current = changes
  useEffect(() => {
    if (changesRef.current === 0) setGrants(new Map(stored))
  }, [stored])

  const scopeOf = (permission: MatrixPermission): EditableScope => {
    if (!permission.scopable) return 'CLINIC'
    return permission.maxScope ?? 'CLINIC'
  }

  function apply(permission: MatrixPermission, on: boolean) {
    setGrants((current) => {
      const next = new Map(current)
      if (on) next.set(permission.key, stored.get(permission.key) ?? scopeOf(permission))
      else next.delete(permission.key)
      return next
    })
    setSaved(false)
    setRowErrors(({ [permission.key]: _removed, ...rest }) => rest)
  }

  function toggle(permission: MatrixPermission, on: boolean) {
    // A sensitive permission this role did not already have asks before it is ticked.
    if (on && permission.dangerous && !stored.has(permission.key)) {
      setConfirming(permission)
      return
    }
    apply(permission, on)
  }

  async function save() {
    const permissions = [...grants]
      .map(([key, scope]) => ({ key, scope }))
      .sort((a, b) => a.key.localeCompare(b.key))
    setPending(true)
    setGeneral(null)
    setSaved(false)
    setRowErrors({})
    try {
      await apiFetch(`/api/v1/admin/roles/${roleId}/permissions`, {
        method: 'PUT',
        body: { permissions },
      })
      setSaved(true)
      router.refresh()
    } catch (caught) {
      setGeneral(errorMessage(caught))
      if (caught instanceof ApiError) {
        const marked: Record<string, string> = {}
        for (const detail of caught.details) {
          const target = detail.field.replace(/^permissions\./, '')
          // "permissions.patient:delete" names the row; "permissions.3" is a position in the list sent.
          const key = target.includes(':') ? target : permissions[Number(target)]?.key
          if (key) marked[key] = validationMessage(detail.issue)
        }
        setRowErrors(marked)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {saved ? <Alert tone="success">{t('matrixSaved')}</Alert> : null}
      {general ? <Alert tone="danger">{general}</Alert> : null}

      {groups.map((group) => (
        <fieldset key={group.id} className="flex min-w-0 flex-col">
          <legend className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            {group.label}
          </legend>
          <ul className="divide-border flex flex-col divide-y">
            {group.permissions.map((permission) => {
              const checked = grants.has(permission.key)
              const scope = grants.get(permission.key) ?? scopeOf(permission)
              const grantable = permission.maxScope !== null
              const selectId = `${baseId}-${permission.key}`
              return (
                <li key={permission.key} className="flex flex-col gap-1 py-1.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <Checkbox
                        checked={checked}
                        disabled={readOnly || pending || (!checked && !grantable)}
                        onChange={(event) => toggle(permission, event.target.checked)}
                      />
                      <span className="flex flex-wrap items-center gap-2">
                        {permission.label}
                        {permission.phi ? <Badge tone="info">{t('medical')}</Badge> : null}
                        {permission.dangerous ? (
                          <Badge tone="warning">{t('sensitive')}</Badge>
                        ) : null}
                      </span>
                    </label>
                    {checked && permission.scopable ? (
                      <div className="flex items-center gap-2 ps-8 sm:ps-0">
                        <label htmlFor={selectId} className="text-muted-foreground text-xs">
                          {t('reach')}
                        </label>
                        <Select
                          id={selectId}
                          value={scope}
                          disabled={readOnly || pending}
                          className="w-44"
                          onChange={(event) => {
                            const value = event.target.value
                            setGrants((current) => new Map(current).set(permission.key, value))
                            setSaved(false)
                          }}
                        >
                          {EDITABLE_SCOPES.map((option) => {
                            const widerThanEditor =
                              permission.maxScope !== null &&
                              RANK[option]! > RANK[permission.maxScope]!
                            // Keeping a reach the role already has is not granting it.
                            const alreadyHeld = stored.get(permission.key) === option
                            return (
                              <option
                                key={option}
                                value={option}
                                disabled={widerThanEditor && !alreadyHeld}
                              >
                                {tScopes(option)}
                              </option>
                            )
                          })}
                        </Select>
                      </div>
                    ) : null}
                  </div>
                  {!checked && !grantable && !readOnly ? (
                    <p className="text-muted-foreground ps-8 text-xs">{t('notYours')}</p>
                  ) : null}
                  {rowErrors[permission.key] ? (
                    <p className="text-danger ps-8 text-xs font-medium">
                      {rowErrors[permission.key]}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </fieldset>
      ))}

      {!readOnly && changes > 0 ? (
        <div className="border-border bg-card sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border p-3 shadow-lg md:bottom-4">
          <span role="status" className="text-sm font-medium">
            {t('changes', { count: changes })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => {
                setGrants(new Map(stored))
                setRowErrors({})
                setGeneral(null)
              }}
            >
              {t('discard')}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void save()}>
              {pending ? <Spinner /> : null}
              {pending ? tCommon('saving') : t('save')}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('grantTitle', { permission: confirming?.label ?? '' })}</DialogTitle>
            <DialogDescription>{t('grantBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tCommon('cancel')}</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                if (confirming) apply(confirming, true)
                setConfirming(null)
              }}
            >
              {t('grantConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
