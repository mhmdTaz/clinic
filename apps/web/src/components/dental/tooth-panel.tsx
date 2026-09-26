'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  AddToothRecordRequest,
  issueCode,
  issuePath,
  type DentalSymbol,
  type DentalTreatment,
  type LabOrder,
  type QuickPick,
  type ToothRecord,
  type ToothRecordStatus,
  type ToothRole,
  type ToothState,
  type ToothSurface,
} from '@clinic/contracts'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Spinner,
  Textarea,
  cn,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import type { VoiceDraft } from '@/lib/dental/voice'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { SymbolIcon } from './symbol-icon'
import { ToothPictures } from './tooth-pictures'
import { toneOf } from './tooth-visual'

/**
 * One tooth: everything that was ever charted on it, newest first, and the form that charts the
 * next thing. Writes add rows — finishing a plan adds a COMPLETED row, a mistake is voided — so
 * the timeline is the tooth's whole story, and it is what the dentist reads before they start.
 */

const FINDINGS: ReadonlySet<DentalSymbol> = new Set(['CARIES', 'FRACTURE', 'IMPACTED'])

/** The statuses that fit a symbol — the same rule the server applies (domain/rules.ts). */
export function statusesFor(symbol: DentalSymbol): ToothRecordStatus[] {
  if (FINDINGS.has(symbol)) return ['CONDITION']
  if (symbol === 'MISSING') return ['EXISTING', 'CONDITION']
  if (symbol === 'OTHER') return ['CONDITION', 'PLANNED', 'COMPLETED', 'EXISTING']
  return ['COMPLETED', 'PLANNED', 'EXISTING']
}

const isAnterior = (fdi: string) => Number(fdi[1]) <= 3
const jawOf = (fdi: string) => (['1', '2', '5', '6'].includes(fdi[0]!) ? 'UPPER' : 'LOWER')

export interface Visit {
  id: string
  label: string
}

export function TooltipLessStatus({ status }: { status: ToothRecordStatus }) {
  const t = useTranslations('dental')
  return (
    <Badge tone={toneOf(status) === 'done' ? 'info' : 'danger'}>{t(`statuses.${status}`)}</Badge>
  )
}

export function ToothPanel({
  patientId,
  tooth,
  toothLabel,
  sameJaw,
  treatments,
  quickPicks,
  visits,
  defaultVisitId,
  today,
  canWrite,
  files,
  onChanged,
  labOrders = [],
  draft = null,
}: {
  patientId: string
  tooth: ToothState
  toothLabel: (fdi: string) => string
  /** The teeth of this tooth's jaw in chart order, for a bridge or a denture. */
  sameJaw: readonly string[]
  treatments: readonly DentalTreatment[]
  quickPicks: readonly QuickPick[]
  visits: readonly Visit[]
  defaultVisitId: string | null
  today: string
  canWrite: boolean
  /** What the caller may do with documents: the pictures section follows file permissions. */
  files: { canRead: boolean; canUpload: boolean }
  onChanged: () => void
  /** Open lab work naming this tooth (Phase 13). */
  labOrders?: readonly LabOrder[]
  /** What was said, when the tooth was charted by voice: opens the form filled in, unsaved. */
  draft?: VoiceDraft | null
}) {
  const t = useTranslations('dental')
  const errorMessage = useErrorMessage()
  // The formatter is a new function every render; the loader must not depend on it, or loading
  // would re-render, re-create the loader and load again, for ever.
  const describe = useRef(errorMessage)
  describe.current = errorMessage
  const [records, setRecords] = useState<ToothRecord[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [showVoided, setShowVoided] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(Boolean(draft) && canWrite)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<ToothRecord | null>(null)
  const visitLabel = useMemo(
    () => new Map(visits.map((visit) => [visit.id, visit.label])),
    [visits],
  )

  const load = useCallback(
    async (after: string | null) => {
      setLoadError(null)
      try {
        const query = new URLSearchParams({ tooth: tooth.fdi, limit: '20' })
        if (showVoided) query.set('includeVoided', 'true')
        if (after) query.set('cursor', after)
        const response = await fetch(`/api/v1/patients/${patientId}/tooth-records?${query}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const body = (await response.json()) as {
          data?: ToothRecord[]
          meta?: { nextCursor: string | null }
        }
        if (!response.ok) throw new ApiError(response.status, 'INTERNAL_ERROR', '')
        setRecords((current) => [...(after && current ? current : []), ...(body.data ?? [])])
        setCursor(body.meta?.nextCursor ?? null)
      } catch (caught) {
        setLoadError(describe.current(caught))
      }
    },
    [patientId, tooth.fdi, showVoided],
  )

  useEffect(() => {
    setRecords(null)
    setAdding(false)
    setActionError(null)
    void load(null)
  }, [load])

  async function refreshAfter(work: () => Promise<unknown>, key: string) {
    setBusy(key)
    setActionError(null)
    try {
      await work()
      await load(null)
      onChanged()
    } catch (caught) {
      setActionError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const complete = (record: ToothRecord) =>
    refreshAfter(
      () =>
        apiFetch(`/api/v1/tooth-records/${record.id}/complete`, {
          method: 'POST',
          body: { encounterId: defaultVisitId, performedOn: null, doctorId: null, notes: null },
        }),
      record.id,
    )

  const applyPick = (pick: QuickPick) =>
    refreshAfter(
      () =>
        apiFetch(`/api/v1/patients/${patientId}/quick-picks/${pick.id}/apply`, {
          method: 'POST',
          body: {
            teeth: [{ fdi: tooth.fdi, role: null }],
            encounterId: defaultVisitId,
            performedOn: null,
            doctorId: null,
            notes: null,
          },
        }),
      pick.id,
    )

  const livePicks = quickPicks.filter((pick) => pick.isActive)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-base font-medium">{toothLabel(tooth.fdi)}</h3>
        <p className="text-muted-foreground text-sm">
          {tooth.present ? t('panel.present') : t('panel.absent')}
          {tooth.marks.length > 0
            ? ` · ${tooth.marks.map((mark) => t(`symbols.${mark.symbol}`)).join(', ')}`
            : ''}
        </p>
      </div>

      {labOrders.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('lab.onThisTooth')}>
          {labOrders.map((order) => (
            <li key={order.id}>
              <Badge
                tone={
                  order.overdue ? 'danger' : order.status === 'RECEIVED' ? 'success' : 'warning'
                }
              >
                <FlaskConical aria-hidden="true" className="size-3" />
                {order.status === 'RECEIVED'
                  ? t('lab.chipBack', { lab: order.labName })
                  : order.overdue
                    ? t('lab.chipLate', { lab: order.labName, date: order.dueOn })
                    : t('lab.chipAway', { lab: order.labName, date: order.dueOn })}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {canWrite ? (
        <div className="flex flex-col gap-2">
          {livePicks.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label={t('panel.quickPicks')}>
              {livePicks.map((pick) => (
                <Button
                  key={pick.id}
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void applyPick(pick)}
                >
                  {busy === pick.id ? <Spinner /> : null}
                  {pick.name}
                </Button>
              ))}
            </div>
          ) : null}
          {adding && draft ? (
            <Alert tone="info">
              {t('voice.heard', { heard: draft.transcript })}
              {draft.alternatives.length > 0
                ? ` ${t('voice.alternatives', { names: draft.alternatives.join(', ') })}`
                : ''}
            </Alert>
          ) : null}
          {adding ? (
            <AddRecordForm
              initial={draft}
              patientId={patientId}
              tooth={tooth.fdi}
              sameJaw={sameJaw}
              toothLabel={toothLabel}
              treatments={treatments}
              visits={visits}
              defaultVisitId={defaultVisitId}
              today={today}
              onCancel={() => setAdding(false)}
              onSaved={async () => {
                setAdding(false)
                await load(null)
                onChanged()
              }}
            />
          ) : (
            <Button onClick={() => setAdding(true)} className="self-start">
              {t('panel.add')}
            </Button>
          )}
        </div>
      ) : null}

      {files.canRead ? (
        <ToothPictures
          patientId={patientId}
          tooth={tooth.fdi}
          visitId={defaultVisitId}
          canUpload={files.canUpload}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <h4 className="text-sm font-medium">{t('panel.history')}</h4>
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <Checkbox
            checked={showVoided}
            onChange={(event) => setShowVoided(event.target.checked)}
          />
          {t('panel.showVoided')}
        </label>
      </div>

      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}
      {records === null ? (
        <Spinner />
      ) : records.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('panel.empty')}</p>
      ) : (
        <ol className="flex flex-col">
          {records.map((record) => {
            const done = toneOf(record.status) === 'done'
            return (
              <li
                key={record.id}
                className={cn(
                  'flex gap-3 border-t py-3 first:border-t-0',
                  record.voided && 'opacity-60',
                )}
              >
                <SymbolIcon
                  symbol={record.treatment.symbol}
                  size={20}
                  className={cn('mt-0.5 shrink-0', done ? 'text-[#185FA5]' : 'text-[#E24B4A]')}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('text-sm font-medium', record.voided && 'line-through')}>
                      {record.treatment.name}
                      {record.surfaces.length > 0 ? ` (${record.surfaces.join('')})` : ''}
                      {record.teeth.length > 1
                        ? ` · ${record.teeth.map((item) => item.fdi).join('–')}`
                        : ''}
                    </span>
                    <TooltipLessStatus status={record.status} />
                    {record.completedByRecordId ? (
                      <Badge tone="success">{t('panel.carriedOut')}</Badge>
                    ) : null}
                    {record.voided ? <Badge tone="neutral">{t('panel.voided')}</Badge> : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {[
                      record.performedOn,
                      record.encounterId
                        ? (visitLabel.get(record.encounterId) ?? t('panel.aVisit'))
                        : null,
                      record.doctor?.name ?? null,
                      record.recordedBy
                        ? t('panel.chartedBy', { name: record.recordedBy.name })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {record.notes ? (
                    <p className="text-sm whitespace-pre-line">{record.notes}</p>
                  ) : null}
                  {record.voided ? (
                    <p className="text-muted-foreground text-xs">
                      {t('panel.voidedBecause', { reason: record.voided.reason })}
                    </p>
                  ) : null}
                  {canWrite && !record.voided ? (
                    <div className="flex flex-wrap gap-2">
                      {record.status === 'PLANNED' && !record.completedByRecordId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy !== null}
                          onClick={() => void complete(record)}
                        >
                          {busy === record.id ? <Spinner /> : null}
                          {t('panel.markDone')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => setVoiding(record)}
                      >
                        {t('panel.void')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {cursor ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(cursor)}
          className="self-start"
        >
          {t('panel.more')}
        </Button>
      ) : null}

      <VoidDialog
        record={voiding}
        onClose={() => setVoiding(null)}
        onVoid={(record, reason) =>
          refreshAfter(async () => {
            await apiFetch(`/api/v1/tooth-records/${record.id}/void`, {
              method: 'POST',
              body: { reason },
            })
            setVoiding(null)
          }, record.id)
        }
      />
    </div>
  )
}

function VoidDialog({
  record,
  onClose,
  onVoid,
}: {
  record: ToothRecord | null
  onClose: () => void
  onVoid: (record: ToothRecord, reason: string) => Promise<void>
}) {
  const t = useTranslations('dental')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setReason('')
    setError(null)
  }, [record])

  return (
    <Dialog open={record !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('void.title')}</DialogTitle>
          <DialogDescription>{t('void.body')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!record) return
            if (reason.trim() === '') {
              setError(t('void.reasonRequired'))
              return
            }
            setPending(true)
            await onVoid(record, reason.trim())
            setPending(false)
          }}
        >
          <Label htmlFor="void-reason">{t('void.reason')}</Label>
          <Textarea
            id="void-reason"
            value={reason}
            maxLength={300}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setReason(event.target.value)
              setError(null)
            }}
          />
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('form.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t('void.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddRecordForm({
  patientId,
  tooth,
  sameJaw,
  toothLabel,
  treatments,
  visits,
  defaultVisitId,
  today,
  onCancel,
  onSaved,
  initial = null,
}: {
  patientId: string
  tooth: string
  sameJaw: readonly string[]
  toothLabel: (fdi: string) => string
  treatments: readonly DentalTreatment[]
  visits: readonly Visit[]
  defaultVisitId: string | null
  today: string
  onCancel: () => void
  onSaved: () => Promise<void>
  /** A voice draft to start from; the person saving it is the one who charts it. */
  initial?: VoiceDraft | null
}) {
  const t = useTranslations('dental')
  const errorMessage = useErrorMessage()
  const validationMessage = useValidationMessage()
  const active = treatments.filter((treatment) => treatment.isActive)
  const [treatmentId, setTreatmentId] = useState(
    initial && active.some((item) => item.id === initial.treatmentId)
      ? initial.treatmentId
      : (active[0]?.id ?? ''),
  )
  const treatment = active.find((item) => item.id === treatmentId) ?? null
  const [status, setStatus] = useState<ToothRecordStatus>(() => {
    const allowed = treatment
      ? statusesFor(treatment.symbol)
      : (['COMPLETED'] as ToothRecordStatus[])
    // A status the treatment cannot have ("a filling found") falls back to its first.
    return initial?.status && allowed.includes(initial.status) ? initial.status : allowed[0]!
  })
  const [surfaces, setSurfaces] = useState<ToothSurface[]>(initial ? [...initial.surfaces] : [])
  const [spanTo, setSpanTo] = useState<string>('')
  const [roles, setRoles] = useState<Record<string, ToothRole>>({})
  const [archTeeth, setArchTeeth] = useState<string[]>([tooth])
  const [visitId, setVisitId] = useState(defaultVisitId ?? '')
  const [performedOn, setPerformedOn] = useState(today)
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const scope = treatment?.scope ?? 'TOOTH'
  const anterior = isAnterior(tooth)
  const surfaceChoices: ToothSurface[] = ['M', 'D', anterior ? 'I' : 'O', 'B', 'L']
  const jawTeeth = sameJaw.filter((fdi) => jawOf(fdi) === jawOf(tooth))

  // A bridge runs from this tooth to another along the arch; everything between is a pontic.
  const spanTeeth = useMemo(() => {
    if (scope !== 'SPAN' || !spanTo) return []
    const a = jawTeeth.indexOf(tooth)
    const b = jawTeeth.indexOf(spanTo)
    if (a === -1 || b === -1) return []
    return jawTeeth.slice(Math.min(a, b), Math.max(a, b) + 1)
  }, [scope, spanTo, jawTeeth, tooth])

  const roleOf = (fdi: string, index: number, count: number): ToothRole =>
    roles[fdi] ?? (index === 0 || index === count - 1 ? 'ABUTMENT' : 'PONTIC')

  function chooseTreatment(id: string) {
    setTreatmentId(id)
    const next = active.find((item) => item.id === id)
    if (next) setStatus(statusesFor(next.symbol)[0]!)
    setSurfaces([])
    setErrors({})
  }

  async function save() {
    setErrors({})
    setGeneral(null)
    const teeth =
      scope === 'SPAN'
        ? spanTeeth.map((fdi, index) => ({ fdi, role: roleOf(fdi, index, spanTeeth.length) }))
        : scope === 'ARCH'
          ? archTeeth.map((fdi) => ({ fdi, role: 'DENTURE_TOOTH' as const }))
          : [{ fdi: tooth, role: null }]
    const parsed = AddToothRecordRequest.safeParse({
      teeth,
      surfaces: scope === 'SURFACE' ? surfaces : [],
      treatmentId,
      status,
      encounterId: visitId || null,
      performedOn,
      doctorId: null,
      notes,
    })
    if (!parsed.success) {
      const placed: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        placed[issuePath(issue).split('.')[0]!] = validationMessage(issueCode(issue))
      }
      setErrors(placed)
      return
    }
    setPending(true)
    try {
      await apiFetch(`/api/v1/patients/${patientId}/tooth-records`, {
        method: 'POST',
        body: parsed.data,
      })
      await onSaved()
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        const placed: Record<string, string> = {}
        for (const detail of caught.details)
          placed[detail.field.split('.')[0]!] = validationMessage(detail.issue)
        setErrors(placed)
      } else setGeneral(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const fieldError = (field: string) =>
    errors[field] ? <p className="text-danger text-sm">{errors[field]}</p> : null

  const findings = active.filter((item) => FINDINGS.has(item.symbol) || item.symbol === 'MISSING')
  const work = active.filter((item) => !findings.includes(item))

  return (
    <form
      className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {general ? <Alert tone="danger">{general}</Alert> : null}

      <div className="flex flex-col gap-1">
        <Label htmlFor="dental-treatment">{t('form.treatment')}</Label>
        <Select
          id="dental-treatment"
          value={treatmentId}
          onChange={(event) => chooseTreatment(event.target.value)}
        >
          <optgroup label={t('form.findings')}>
            {findings.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('form.work')}>
            {work.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </optgroup>
        </Select>
        {fieldError('treatmentId')}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dental-status">{t('form.status')}</Label>
        <Select
          id="dental-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as ToothRecordStatus)}
        >
          {(treatment ? statusesFor(treatment.symbol) : []).map((option) => (
            <option key={option} value={option}>
              {t(`statuses.${option}`)}
            </option>
          ))}
        </Select>
        {fieldError('status')}
      </div>

      {scope === 'SURFACE' ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('form.surfaces')}</legend>
          <div className="flex flex-wrap gap-2">
            {surfaceChoices.map((surface) => {
              const on = surfaces.includes(surface)
              return (
                <Button
                  key={surface}
                  type="button"
                  size="sm"
                  variant={on ? 'primary' : 'outline'}
                  aria-pressed={on}
                  title={t(`surfaces.${surface}`)}
                  onClick={() =>
                    setSurfaces((current) =>
                      on ? current.filter((item) => item !== surface) : [...current, surface],
                    )
                  }
                >
                  {surface}
                </Button>
              )
            })}
          </div>
          {fieldError('surfaces')}
        </fieldset>
      ) : null}

      {scope === 'SPAN' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="dental-span">{t('form.spanTo')}</Label>
          <Select
            id="dental-span"
            value={spanTo}
            onChange={(event) => setSpanTo(event.target.value)}
          >
            <option value="">{t('form.choose')}</option>
            {jawTeeth
              .filter((fdi) => fdi !== tooth)
              .map((fdi) => (
                <option key={fdi} value={fdi}>
                  {toothLabel(fdi)}
                </option>
              ))}
          </Select>
          {spanTeeth.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {spanTeeth.map((fdi, index) => (
                <li key={fdi} className="flex items-center gap-2 text-sm">
                  <span className="w-10 tabular-nums">{fdi}</span>
                  <Select
                    aria-label={t('form.roleFor', { tooth: fdi })}
                    value={roleOf(fdi, index, spanTeeth.length)}
                    onChange={(event) =>
                      setRoles((current) => ({
                        ...current,
                        [fdi]: event.target.value as ToothRole,
                      }))
                    }
                  >
                    <option value="ABUTMENT">{t('roles.ABUTMENT')}</option>
                    <option value="PONTIC">{t('roles.PONTIC')}</option>
                  </Select>
                </li>
              ))}
            </ul>
          ) : null}
          {fieldError('teeth')}
        </div>
      ) : null}

      {scope === 'ARCH' ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('form.dentureTeeth')}</legend>
          <div className="flex flex-wrap gap-1">
            {jawTeeth.map((fdi) => {
              const on = archTeeth.includes(fdi)
              return (
                <Button
                  key={fdi}
                  type="button"
                  size="sm"
                  variant={on ? 'primary' : 'outline'}
                  aria-pressed={on}
                  className="w-12 px-0 tabular-nums"
                  onClick={() =>
                    setArchTeeth((current) =>
                      on ? current.filter((item) => item !== fdi) : [...current, fdi],
                    )
                  }
                >
                  {fdi}
                </Button>
              )
            })}
          </div>
          {fieldError('teeth')}
        </fieldset>
      ) : scope !== 'SPAN' ? (
        fieldError('teeth')
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="dental-visit">{t('form.visit')}</Label>
          <Select
            id="dental-visit"
            value={visitId}
            onChange={(event) => setVisitId(event.target.value)}
          >
            <option value="">{t('form.noVisit')}</option>
            {visits.map((visit) => (
              <option key={visit.id} value={visit.id}>
                {visit.label}
              </option>
            ))}
          </Select>
          {fieldError('encounterId')}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dental-date">{t('form.date')}</Label>
          <Input
            id="dental-date"
            type="date"
            value={performedOn}
            max={today}
            onChange={(event) => setPerformedOn(event.target.value)}
          />
          {fieldError('performedOn')}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="dental-notes">{t('form.notes')}</Label>
        <Textarea
          id="dental-notes"
          value={notes}
          maxLength={1000}
          placeholder={t('form.notesPlaceholder')}
          onChange={(event) => setNotes(event.target.value)}
        />
        {fieldError('notes')}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !treatment}>
          {pending ? <Spinner /> : null}
          {t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  )
}
