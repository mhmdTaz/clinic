'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { CheckCircle2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { DentalChart, PresignedUpload, StoredFile, TreatmentPlan } from '@clinic/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Spinner,
  Textarea,
  buttonVariants,
  cn,
} from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { hasWebGL } from '../dental-chart'
import { Odontogram2D } from '../odontogram-2d'
import { SignaturePad, type SignaturePadHandle } from './signature-pad'
import { teethForPlan } from './plan-money'

const Jaw3D = dynamic(() => import('../jaw-3d').then((module) => module.Jaw3D), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[420px] w-full rounded-lg" />,
})

type Step = 'review' | 'sign' | 'decline' | 'agreed' | 'declined'

/**
 * Presenting a plan to the patient (Phase 12): the whole screen, for a tablet turned to face
 * them. The jaw shows what is already done and only the work in this plan still to do, so the
 * picture is the plan; the notes and the chart's other plans stay out of it. Prices can be hidden
 * while the dentist explains the work, and shown when the conversation gets there.
 *
 * Opening it records that the plan was shown. The patient answers here: yes with their name and
 * a signature — uploaded to their file first, then the plan is accepted pointing at it — or no.
 */
export function PlanPresentation({
  plan: initial,
  chart,
  patient,
  locale,
  closeHref,
}: {
  plan: TreatmentPlan
  chart: DentalChart
  patient: { id: string; name: string }
  locale: string
  closeHref: string
}) {
  const t = useTranslations('dental.plans.present')
  const tDental = useTranslations('dental')
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [plan, setPlan] = useState(initial)
  const [step, setStep] = useState<Step>(
    initial.status === 'ACCEPTED' || initial.status === 'COMPLETED'
      ? 'agreed'
      : initial.status === 'DECLINED'
        ? 'declined'
        : 'review',
  )
  const [showPrices, setShowPrices] = useState(true)
  const [mode, setMode] = useState<'3d' | '2d'>('2d')
  const [selected, setSelected] = useState<string | null>(null)
  const [signedBy, setSignedBy] = useState(patient.name)
  const [inked, setInked] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pad = useRef<SignaturePadHandle>(null)
  const presented = useRef(false)

  const undecided = plan.status === 'DRAFT' || plan.status === 'PRESENTED'

  // Showing it is on the record, once per opening. A plan answered already is only looked at.
  useEffect(() => {
    if (presented.current || !undecided) return
    presented.current = true
    apiFetch<TreatmentPlan>(`/api/v1/treatment-plans/${plan.id}/present`, { method: 'POST' })
      .then(setPlan)
      .catch((caught: unknown) => setError(errorMessage(caught)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (hasWebGL() && chart.dentition !== 'MIXED') setMode('3d')
  }, [chart.dentition])

  const teeth = useMemo(() => teethForPlan(chart.teeth, plan.items), [chart.teeth, plan.items])
  const planTeeth = useMemo(
    () => [...new Set(plan.items.flatMap((item) => item.teeth.map((tooth) => tooth.fdi)))],
    [plan.items],
  )

  const toothLabel = useCallback(
    (fdi: string) => {
      const quadrant = Number(fdi[0])
      const primary = quadrant >= 5
      return tDental('tooth', {
        fdi,
        place: tDental(`quadrants.${primary ? quadrant - 4 : quadrant}`),
        name: tDental(`${primary ? 'primaryNames' : 'names'}.${fdi[1]}`),
      })
    },
    [tDental],
  )

  async function signature(): Promise<string | null> {
    const blob = await pad.current?.toBlob()
    if (!blob) return null
    const presigned = await apiFetch<PresignedUpload>('/api/v1/files/presign-upload', {
      method: 'POST',
      body: {
        ownerType: 'PATIENT',
        ownerId: patient.id,
        category: 'CONSENT',
        fileName: 'treatment-plan-signature.png',
        mimeType: 'image/png',
        sizeBytes: blob.size,
        isPatientVisible: false,
        description: plan.title.slice(0, 200),
        teeth: [],
      },
    })
    const stored = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: presigned.headers,
      body: blob,
      // Storage is another origin: our session must not ride along with the bytes.
      credentials: 'omit',
    })
    if (!stored.ok) throw new ApiError(stored.status, 'UPLOAD_FAILED', '')
    await apiFetch<StoredFile>(`/api/v1/files/${presigned.fileId}/confirm`, {
      method: 'POST',
      body: { checksumSha256: null },
    })
    return presigned.fileId
  }

  async function agree() {
    setPending(true)
    setError(null)
    try {
      const signatureFileId = await signature()
      const accepted = await apiFetch<TreatmentPlan>(`/api/v1/treatment-plans/${plan.id}/accept`, {
        method: 'POST',
        body: { signedBy: signedBy.trim(), signatureFileId },
      })
      setPlan(accepted)
      setStep('agreed')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  async function decline() {
    setPending(true)
    setError(null)
    try {
      const declined = await apiFetch<TreatmentPlan>(`/api/v1/treatment-plans/${plan.id}/decline`, {
        method: 'POST',
        body: { reason: reason.trim() || null },
      })
      setPlan(declined)
      setStep('declined')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  const money = (amount: string, tone?: 'strong' | 'muted') =>
    showPrices ? (
      <Money amount={amount} currency={plan.currency} locale={locale} tone={tone} />
    ) : null

  return (
    <div
      className="bg-background fixed inset-0 z-50 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-presentation-title"
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-sm">{patient.name}</p>
          <h1 id="plan-presentation-title" className="truncate text-xl font-semibold">
            {plan.title}
          </h1>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showPrices}
            onChange={(event) => setShowPrices(event.target.checked)}
          />
          {t('showPrices')}
        </label>
        <div role="group" aria-label={tDental('viewLabel')} className="inline-flex">
          <Button
            size="sm"
            variant={mode === '3d' ? 'secondary' : 'outline'}
            aria-pressed={mode === '3d'}
            disabled={chart.dentition === 'MIXED'}
            className="rounded-r-none"
            onClick={() => setMode('3d')}
          >
            {tDental('view3d')}
          </Button>
          <Button
            size="sm"
            variant={mode === '2d' ? 'secondary' : 'outline'}
            aria-pressed={mode === '2d'}
            className="-ml-px rounded-l-none"
            onClick={() => setMode('2d')}
          >
            {tDental('view2d')}
          </Button>
        </div>
        <Link href={closeHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <X aria-hidden="true" className="size-5" />
          {t('close')}
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
        <div className="min-h-[420px] lg:min-h-0">
          {mode === '3d' && chart.dentition !== 'MIXED' ? (
            <Jaw3D
              dentition={chart.dentition}
              teeth={teeth}
              selected={selected}
              highlight={planTeeth}
              active
              onSelect={setSelected}
              toothLabel={toothLabel}
            />
          ) : (
            <div className="bg-card rounded-lg border p-2">
              <Odontogram2D
                dentition={chart.dentition}
                teeth={teeth}
                selected={selected}
                highlight={planTeeth}
                onSelect={setSelected}
                toothLabel={toothLabel}
                labels={{
                  right: tDental('sides.right'),
                  left: tDental('sides.left'),
                  upper: tDental('jaws.upper'),
                  lower: tDental('jaws.lower'),
                  chart: tDental('chartLabel'),
                }}
              />
            </div>
          )}
        </div>

        <aside className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto" aria-live="polite">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <ol className="flex flex-col gap-4">
            {plan.phases.map((phase, index) => {
              const items = plan.items.filter(
                (item) => item.phase === index && item.state !== 'DROPPED',
              )
              if (items.length === 0) return null
              return (
                <li key={index}>
                  <h2 className="text-muted-foreground mb-2 text-sm font-medium tracking-wide uppercase">
                    {t('phase', { number: index + 1 })} · {phase}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((item) => {
                      const fdis = item.teeth.map((tooth) => tooth.fdi)
                      const active = selected !== null && fdis.includes(selected)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(fdis[0] ?? null)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-lg border p-3 text-start text-base transition-colors',
                              active ? 'border-primary bg-primary/5' : 'hover:bg-muted',
                            )}
                          >
                            {item.state === 'DONE' ? (
                              <CheckCircle2 aria-hidden="true" className="text-success size-5" />
                            ) : null}
                            <span className="flex-1">{item.description}</span>
                            {money(item.lineTotal)}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ol>

          {showPrices ? (
            <dl className="flex flex-col gap-1 border-t pt-3 text-base">
              {!/^0(\.0+)?$/.test(plan.discountTotal) ? (
                <div className="flex justify-between">
                  <dt>{t('discount')}</dt>
                  <dd>
                    −<Money amount={plan.discountTotal} currency={plan.currency} locale={locale} />
                  </dd>
                </div>
              ) : null}
              <div className="flex justify-between text-lg">
                <dt className="font-semibold">{t('total')}</dt>
                <dd>{money(plan.total, 'strong')}</dd>
              </div>
            </dl>
          ) : null}

          {step === 'review' && undecided ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" className="flex-1" onClick={() => setStep('sign')}>
                {t('agree')}
              </Button>
              <Button size="lg" variant="outline" onClick={() => setStep('decline')}>
                {t('notNow')}
              </Button>
            </div>
          ) : null}

          {step === 'sign' ? (
            <section
              className="flex flex-col gap-3 rounded-lg border p-4"
              aria-label={t('signTitle')}
            >
              <p className="text-sm">{t('consent')}</p>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fieldId}-name`}>{t('signedBy')}</Label>
                <Input
                  id={`${fieldId}-name`}
                  value={signedBy}
                  maxLength={120}
                  onChange={(event) => setSignedBy(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{t('signHere')}</span>
                <SignaturePad
                  ref={pad}
                  label={t('signHere')}
                  onInk={setInked}
                  className="h-40 w-full rounded-md border"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => pad.current?.clear()}
                >
                  {t('clearSignature')}
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="lg"
                  className="flex-1"
                  disabled={pending || !inked || signedBy.trim() === ''}
                  onClick={() => void agree()}
                >
                  {pending ? <Spinner className="size-4" /> : null}
                  {t('signAndAgree')}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setStep('review')}
                >
                  {t('back')}
                </Button>
              </div>
            </section>
          ) : null}

          {step === 'decline' ? (
            <section
              className="flex flex-col gap-3 rounded-lg border p-4"
              aria-label={t('declineTitle')}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${fieldId}-reason`}>{t('declineReason')}</Label>
                <Textarea
                  id={`${fieldId}-reason`}
                  rows={3}
                  maxLength={300}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="lg"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void decline()}
                >
                  {pending ? <Spinner className="size-4" /> : null}
                  {t('confirmDecline')}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setStep('review')}
                >
                  {t('back')}
                </Button>
              </div>
            </section>
          ) : null}

          {step === 'agreed' ? (
            <Alert tone="success" className="flex flex-col gap-2">
              <span className="font-medium">
                {t('agreedBy', { name: plan.decision?.signedBy ?? '' })}
              </span>
              <Link href={closeHref} className={buttonVariants({ size: 'sm' })}>
                {t('done')}
              </Link>
            </Alert>
          ) : null}
          {step === 'declined' ? (
            <Alert tone="info" className="flex flex-col gap-2">
              <span>{t('declinedNote')}</span>
              <Link href={closeHref} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                {t('done')}
              </Link>
            </Alert>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
