'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, MinusCircle, Printer, Presentation } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  localDateIn,
  type PlanItemBilled,
  type TreatmentPlan,
  type TreatmentPlanItem,
} from '@clinic/contracts'
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Select,
  Spinner,
  Textarea,
  buttonVariants,
  cn,
} from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { formatCalendarDate } from '@/lib/format/dates'
import { useRouter } from '@/lib/navigation/use-router'
import { PlanEditorDialog, type OpenWork } from './plan-editor-dialog'
import { PLAN_TONES } from './plan-money'

export interface PlanVisit {
  id: string
  label: string
}

/**
 * A patient's treatment plans (Phase 12): what was proposed, what the patient said, and how far
 * the agreed work has got. Done work in an agreed plan can be put on a visit's invoice from here,
 * at the agreed price — never automatically, and never twice.
 */
export function TreatmentPlans({
  patientId,
  plans,
  work,
  visits,
  currency,
  locale,
  timeZone,
  basePath,
  canWrite,
  canBill,
}: {
  patientId: string
  plans: TreatmentPlan[]
  work: OpenWork[]
  visits: PlanVisit[]
  currency: string
  locale: string
  timeZone: string
  /** Where this portal's plan pages live: `/staff/patients/{id}/plans`. */
  basePath: string
  canWrite: boolean
  canBill: boolean
}) {
  const t = useTranslations('dental.plans')

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            {work.length > 0 ? t('openWork', { count: work.length }) : t('noOpenWork')}
          </p>
          {work.length > 0 ? (
            <PlanEditorDialog
              patientId={patientId}
              work={work}
              currency={currency}
              locale={locale}
              label={t('new')}
            />
          ) : null}
        </div>
      ) : null}

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <PlanCard
                plan={plan}
                work={work}
                patientId={patientId}
                visits={visits}
                locale={locale}
                timeZone={timeZone}
                basePath={basePath}
                canWrite={canWrite}
                canBill={canBill}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PlanCard({
  plan,
  work,
  patientId,
  visits,
  locale,
  timeZone,
  basePath,
  canWrite,
  canBill,
}: {
  plan: TreatmentPlan
  work: OpenWork[]
  patientId: string
  visits: PlanVisit[]
  locale: string
  timeZone: string
  basePath: string
  canWrite: boolean
  canBill: boolean
}) {
  const t = useTranslations('dental.plans')
  // Instants are shown as the clinic's calendar day they fell on (ADR-0010).
  const day = (at: string) => formatCalendarDate(localDateIn(timeZone, new Date(at)), locale)
  const counted = plan.progress.done + plan.progress.open
  const undecided = plan.status === 'DRAFT' || plan.status === 'PRESENTED'
  const billable = plan.status === 'ACCEPTED' || plan.status === 'COMPLETED'

  // The editor offers what the plan already holds plus any other open work on the chart.
  const editable = undecided
    ? [
        ...work,
        ...plan.items
          .filter(
            (item) =>
              item.state === 'OPEN' && !work.some((entry) => entry.recordId === item.toothRecordId),
          )
          .map((item): OpenWork => ({
            recordId: item.toothRecordId,
            teeth: item.teeth.map((tooth) => tooth.fdi),
            surfaces: item.surfaces,
            treatmentName: item.treatment.name,
            scope: 'TOOTH',
            plannedOn: '',
            listPrice: item.unitPrice,
            taxRatePercent: item.taxRatePercent,
          })),
      ]
    : []

  return (
    <article
      className="rounded-lg border p-4"
      aria-labelledby={`plan-${plan.id}`}
      data-plan-status={plan.status}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`plan-${plan.id}`} className="font-medium">
            {plan.title}
          </h3>
          <p className="text-muted-foreground text-xs">
            {plan.decision
              ? plan.status === 'DECLINED'
                ? t('declinedOn', { date: day(plan.decision.at) })
                : t('agreedOn', {
                    date: day(plan.decision.at),
                    name: plan.decision.signedBy ?? '',
                  })
              : t('draftedOn', { date: day(plan.createdAt) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={PLAN_TONES[plan.status]}>{t(`statuses.${plan.status}`)}</Badge>
          <Money amount={plan.total} currency={plan.currency} locale={locale} tone="strong" />
        </div>
      </header>

      {billable && counted > 0 ? (
        <div className="mt-3">
          <div
            className="bg-muted h-2 overflow-hidden rounded-full"
            role="progressbar"
            aria-label={t('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={counted}
            aria-valuenow={plan.progress.done}
          >
            <div
              className="bg-success h-full"
              style={{ width: `${(plan.progress.done / counted) * 100}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('progress', { done: plan.progress.done, total: counted })} · {t('remaining')}{' '}
            <Money amount={plan.remaining} currency={plan.currency} locale={locale} />
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3">
        {plan.phases.map((phase, index) => {
          const items = plan.items.filter((item) => item.phase === index)
          if (items.length === 0) return null
          return (
            <section key={index} aria-label={phase}>
              <h4 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                {index + 1}. {phase}
              </h4>
              <ul className="flex flex-col gap-1">
                {items.map((item) => (
                  <PlanItemRow
                    key={item.id}
                    plan={plan}
                    item={item}
                    visits={visits}
                    locale={locale}
                    canBill={canBill && billable}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {plan.notes ? <p className="mt-3 text-sm whitespace-pre-wrap">{plan.notes}</p> : null}
      {plan.decision?.reason ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('declineReason', { reason: plan.decision.reason })}
        </p>
      ) : null}
      {plan.cancelled ? (
        <p className="text-muted-foreground mt-2 text-sm">
          {t('cancelledBecause', { reason: plan.cancelled.reason })}
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap gap-2">
        {canWrite && undecided ? (
          <Link href={`${basePath}/${plan.id}/present`} className={buttonVariants({ size: 'sm' })}>
            <Presentation aria-hidden="true" className="size-4" />
            {t('present')}
          </Link>
        ) : null}
        <Link
          href={`${basePath}/${plan.id}/print`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Printer aria-hidden="true" className="size-4" />
          {t('print')}
        </Link>
        {canWrite && undecided ? (
          <PlanEditorDialog
            patientId={patientId}
            plan={plan}
            work={editable}
            currency={plan.currency}
            locale={locale}
            label={t('edit')}
            triggerVariant="outline"
          />
        ) : null}
        {canWrite && undecided ? (
          <ReasonDialog
            planId={plan.id}
            action="decline"
            label={t('recordDecline')}
            required={false}
          />
        ) : null}
        {canWrite && (undecided || plan.status === 'ACCEPTED') ? (
          <ReasonDialog planId={plan.id} action="cancel" label={t('cancel')} required />
        ) : null}
      </footer>
    </article>
  )
}

const STATE_ICONS = { OPEN: Circle, DONE: CheckCircle2, DROPPED: MinusCircle } as const

function PlanItemRow({
  plan,
  item,
  visits,
  locale,
  canBill,
}: {
  plan: TreatmentPlan
  item: TreatmentPlanItem
  visits: PlanVisit[]
  locale: string
  canBill: boolean
}) {
  const t = useTranslations('dental.plans')
  const Icon = STATE_ICONS[item.state]
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm" data-item-state={item.state}>
      <Icon
        aria-hidden="true"
        className={cn(
          'size-4 shrink-0',
          item.state === 'DONE' ? 'text-success' : 'text-muted-foreground',
        )}
      />
      <span
        className={cn('flex-1', item.state === 'DROPPED' && 'text-muted-foreground line-through')}
      >
        {item.description}
        {item.quantity !== '1' ? ` × ${item.quantity}` : ''}
        <span className="sr-only"> · {t(`itemStates.${item.state}`)}</span>
        {item.doneOn ? (
          <span className="text-muted-foreground ms-2 text-xs">
            {t('doneOn', { date: formatCalendarDate(item.doneOn, locale) })}
          </span>
        ) : null}
      </span>
      <Money amount={item.lineTotal} currency={plan.currency} locale={locale} />
      {item.billed ? (
        <Badge tone="neutral">{t('onInvoice', { number: item.billed.invoiceNumber })}</Badge>
      ) : canBill && item.state === 'DONE' ? (
        <BillDialog plan={plan} item={item} visits={visits} locale={locale} />
      ) : null}
    </li>
  )
}

function BillDialog({
  plan,
  item,
  visits,
  locale,
}: {
  plan: TreatmentPlan
  item: TreatmentPlanItem
  visits: PlanVisit[]
  locale: string
}) {
  const t = useTranslations('dental.plans.bill')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  // The visit the work was done in, when it was done in one.
  const preferred = visits.some((visit) => visit.id === item.completedInEncounterId)
    ? item.completedInEncounterId!
    : (visits[0]?.id ?? '')
  const [open, setOpen] = useState(false)
  const [visitId, setVisitId] = useState(preferred)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function bill() {
    setPending(true)
    setError(null)
    try {
      await apiFetch<PlanItemBilled>(`/api/v1/treatment-plans/${plan.id}/items/${item.id}/bill`, {
        method: 'POST',
        body: { encounterId: visitId },
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
        if (pending) return
        setOpen(next)
        setVisitId(preferred)
        setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('body', { work: item.description })}{' '}
            <Money amount={item.lineTotal} currency={plan.currency} locale={locale} tone="strong" />
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {visits.length === 0 ? (
          <Alert tone="info">{t('noVisits')}</Alert>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fieldId}-visit`}>{t('visit')}</Label>
            <Select
              id={`${fieldId}-visit`}
              value={visitId}
              onChange={(event) => setVisitId(event.target.value)}
            >
              {visits.map((visit) => (
                <option key={visit.id} value={visit.id}>
                  {visit.label}
                </option>
              ))}
            </Select>
            <p className="text-muted-foreground text-xs">{t('hint')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={pending || !visitId} onClick={() => void bill()}>
            {pending ? <Spinner className="size-4" /> : null}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReasonDialog({
  planId,
  action,
  label,
  required,
}: {
  planId: string
  action: 'decline' | 'cancel'
  label: string
  required: boolean
}) {
  const t = useTranslations(`dental.plans.${action}Dialog`)
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      await apiFetch(`/api/v1/treatment-plans/${planId}/${action}`, {
        method: 'POST',
        body: { reason: reason.trim() || null },
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
        if (pending) return
        setOpen(next)
        setReason('')
        setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-reason`}>{t('reason')}</Label>
          <Textarea
            id={`${fieldId}-reason`}
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
            {t('back')}
          </Button>
          <Button
            type="button"
            variant={action === 'cancel' ? 'danger' : 'primary'}
            disabled={pending || (required && reason.trim() === '')}
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
