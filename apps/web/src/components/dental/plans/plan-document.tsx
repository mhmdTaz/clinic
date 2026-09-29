import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { localDateIn, type DentalChart, type TreatmentPlan } from '@clinic/contracts'
import type { Actor } from '@clinic/core/access'
import { getClinicLetterhead } from '@clinic/core/clinic'
import { getDownloadLink } from '@clinic/core/files'
import { buttonVariants } from '@clinic/ui'
import { Money } from '@/components/billing/money'
import { formatCalendarDate } from '@/lib/format/dates'
import { PlanChartFigure } from './plan-chart-figure'
import { PrintButton } from './print-button'

/**
 * A treatment plan on paper (Phase 12): for the patient to take home, or to send with a
 * referral. The browser prints it — to paper or to PDF — so there is no document service to run;
 * the portal's chrome is hidden in print and this page is laid out for A4.
 *
 * The chart is drawn flat, with only this plan's work still to do on it, as in the presentation.
 */
export async function PlanDocument({
  actor,
  plan,
  chart,
  patient,
  locale,
  timeZone,
  backHref,
}: {
  actor: Actor
  plan: TreatmentPlan
  chart: DentalChart
  patient: { name: string; medicalRecordNo: string; dateOfBirth: string | null }
  locale: string
  timeZone: string
  backHref: string
}) {
  const t = await getTranslations('dental.plans.document')
  const tPlans = await getTranslations('dental.plans')
  const [letterhead, signature] = await Promise.all([
    getClinicLetterhead(actor.clinicId),
    plan.decision?.signatureFileId
      ? getDownloadLink(actor, plan.decision.signatureFileId).catch(() => null)
      : null,
  ])
  const day = (at: string) => formatCalendarDate(localDateIn(timeZone, new Date(at)), locale)
  const shown = plan.items.filter((item) => item.state !== 'DROPPED')

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none print:gap-4 print:text-[11pt]">
      <div className="flex flex-wrap justify-between gap-2 print:hidden">
        <Link href={backHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          {t('back')}
        </Link>
        <PrintButton label={t('print')} />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-lg font-semibold">{letterhead.legalName ?? letterhead.name}</p>
          {letterhead.addressLines.map((line) => (
            <p key={line} className="text-muted-foreground text-sm">
              {line}
            </p>
          ))}
          <p className="text-muted-foreground text-sm">
            {[letterhead.phone, letterhead.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="text-end text-sm">
          <p className="font-medium">{patient.name}</p>
          <p className="text-muted-foreground">{patient.medicalRecordNo}</p>
          {patient.dateOfBirth ? (
            <p className="text-muted-foreground">
              {t('born', { date: formatCalendarDate(patient.dateOfBirth, locale) })}
            </p>
          ) : null}
        </div>
      </header>

      <div>
        <p className="text-muted-foreground text-sm">{t('heading')}</p>
        <h1 className="text-2xl font-semibold">{plan.title}</h1>
        <p className="text-muted-foreground text-sm">
          {tPlans(`statuses.${plan.status}`)} · {t('drawnUp', { date: day(plan.createdAt) })}
        </p>
      </div>

      <figure className="break-inside-avoid rounded-lg border p-2">
        <PlanChartFigure chart={chart} plan={plan} />
      </figure>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-start">
            <th className="py-2 text-start font-medium">{t('work')}</th>
            <th className="py-2 text-end font-medium">{t('price')}</th>
            <th className="py-2 text-end font-medium">{t('discount')}</th>
            <th className="py-2 text-end font-medium">{t('amount')}</th>
          </tr>
        </thead>
        {plan.phases.map((phase, index) => {
          const items = shown.filter((item) => item.phase === index)
          if (items.length === 0) return null
          return (
            <tbody key={index} className="break-inside-avoid">
              <tr>
                <th colSpan={4} className="pt-3 pb-1 text-start font-semibold">
                  {index + 1}. {phase}
                </th>
              </tr>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0">
                  <td className="py-1.5 pe-2">
                    {item.description}
                    {item.quantity !== '1' ? ` × ${item.quantity}` : ''}
                    {item.state === 'DONE' && item.doneOn ? (
                      <span className="text-muted-foreground ms-2 text-xs">
                        {tPlans('doneOn', { date: formatCalendarDate(item.doneOn, locale) })}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-end">
                    <Money amount={item.gross} currency={plan.currency} locale={locale} />
                  </td>
                  <td className="py-1.5 text-end">
                    <Money
                      amount={item.discount}
                      currency={plan.currency}
                      locale={locale}
                      tone="muted"
                    />
                  </td>
                  <td className="py-1.5 text-end">
                    <Money amount={item.lineTotal} currency={plan.currency} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          )
        })}
        <tfoot className="break-inside-avoid">
          <tr className="border-t">
            <td colSpan={3} className="pt-2 text-end">
              {t('subtotal')}
            </td>
            <td className="pt-2 text-end">
              <Money amount={plan.subtotal} currency={plan.currency} locale={locale} />
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="text-end">
              {t('discount')}
            </td>
            <td className="text-end">
              <Money amount={plan.discountTotal} currency={plan.currency} locale={locale} />
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="text-end">
              {t('tax')}
            </td>
            <td className="text-end">
              <Money amount={plan.taxTotal} currency={plan.currency} locale={locale} />
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="pt-1 text-end font-semibold">
              {t('total')}
            </td>
            <td className="pt-1 text-end">
              <Money amount={plan.total} currency={plan.currency} locale={locale} tone="strong" />
            </td>
          </tr>
        </tfoot>
      </table>

      {plan.notes ? (
        <section className="break-inside-avoid">
          <h2 className="font-medium">{t('notes')}</h2>
          <p className="text-sm whitespace-pre-wrap">{plan.notes}</p>
        </section>
      ) : null}

      <section className="mt-4 grid break-inside-avoid gap-6 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-xs">{t('patientSignature')}</p>
          <div className="flex h-24 items-end border-b">
            {signature ? (
              // A presigned object-storage URL, not something next/image can optimise.
              <img src={signature.url} alt={t('signatureAlt')} className="max-h-24" />
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            {plan.decision && plan.status !== 'DECLINED'
              ? t('signedOn', { name: plan.decision.signedBy ?? '', date: day(plan.decision.at) })
              : t('nameAndDate')}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{t('clinicSignature')}</p>
          <div className="h-24 border-b" />
          <p className="mt-1 text-sm">{plan.createdBy?.name ?? ''}</p>
        </div>
      </section>

      <p className="text-muted-foreground text-xs">{t('validity')}</p>
    </div>
  )
}
