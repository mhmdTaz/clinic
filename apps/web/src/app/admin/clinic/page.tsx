import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { localDateIn } from '@clinic/contracts'
import { holds } from '@clinic/core/access'
import { getClinicSettings } from '@clinic/core/clinic'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { PageHeader } from '@/components/portal/page-header'
import { requirePortal } from '@/lib/auth/server-session'
import { WEEK_ORDER, weekdayName } from '@/lib/format/weekdays'
import {
  countryOptions,
  currencyOptions,
  localeOptions,
  timezoneOptions,
} from '@/lib/format/regions'
import { ClinicProfileForm } from './clinic-profile-form'
import { HolidaysCard } from './holidays-card'
import { LocationsCard } from './locations-card'
import { OpeningHoursCard } from './opening-hours-card'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.clinic')
  return { title: t('title') }
}

export default async function ClinicSettingsPage() {
  const actor = await requirePortal('admin')
  const [settings, t, locale] = await Promise.all([
    getClinicSettings(actor),
    getTranslations('admin.clinic'),
    getLocale(),
  ])
  const canEdit = holds(actor, 'clinic:update')

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ClinicProfileForm
              settings={settings}
              countries={countryOptions(locale)}
              timezones={timezoneOptions(settings.timezone)}
              currencies={currencyOptions(locale)}
              locales={localeOptions(locale)}
              readOnly={!canEdit}
            />
          </CardContent>
        </Card>

        <LocationsCard branches={settings.branches} canManage={holds(actor, 'branch:manage')} />

        <OpeningHoursCard
          branches={settings.branches}
          timezone={settings.timezone}
          weekdays={WEEK_ORDER.map((day) => ({ day, name: weekdayName(day, locale) }))}
          canEdit={canEdit}
        />

        <HolidaysCard
          holidays={settings.holidays}
          branches={settings.branches.map(({ id, name }) => ({ id, name }))}
          today={localDateIn(settings.timezone)}
          locale={locale}
          canEdit={canEdit}
        />
      </div>
    </>
  )
}
