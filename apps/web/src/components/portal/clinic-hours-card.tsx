import { getLocale, getTranslations } from 'next-intl/server'
import type { ClinicProfile } from '@clinic/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { formatCalendarDate } from '@/lib/format/dates'
import { WEEK_ORDER, weekdayName } from '@/lib/format/weekdays'

export async function ClinicHoursCard({ clinic }: { clinic: ClinicProfile }) {
  const [t, locale] = await Promise.all([getTranslations('clinic'), getLocale()])
  const branches = clinic.branches.filter((branch) => branch.isActive)
  const branchName = (id: string | null) =>
    id ? (clinic.branches.find((branch) => branch.id === id)?.name ?? '') : t('closureEverywhere')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('hoursTitle')}</CardTitle>
        <CardDescription>{t('hoursNote', { timezone: clinic.timezone })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {branches.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('noHours')}</p>
        ) : (
          branches.map((branch) => (
            <div key={branch.id}>
              {branches.length > 1 ? (
                <p className="mb-1 text-sm font-medium">{branch.name}</p>
              ) : null}
              <dl className="divide-border divide-y text-sm">
                {WEEK_ORDER.map((day) => {
                  const hours = branch.workingHours.filter((entry) => entry.dayOfWeek === day)
                  return (
                    <div key={day} className="flex justify-between gap-4 py-2">
                      <dt>{weekdayName(day, locale)}</dt>
                      <dd
                        className={
                          hours.length > 0 ? 'font-medium tabular-nums' : 'text-muted-foreground'
                        }
                      >
                        {hours.length > 0
                          ? hours.map((entry) => `${entry.opensAt}–${entry.closesAt}`).join(', ')
                          : t('closed')}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          ))
        )}

        {clinic.upcomingHolidays.length > 0 ? (
          <div>
            <p className="mb-1 text-sm font-medium">{t('closuresTitle')}</p>
            <ul className="divide-border divide-y text-sm">
              {clinic.upcomingHolidays.map((holiday) => (
                <li
                  key={`${holiday.date}-${holiday.branchId ?? 'all'}`}
                  className="flex justify-between gap-4 py-2"
                >
                  <span>
                    {holiday.name}
                    {branches.length > 1 ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {branchName(holiday.branchId)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCalendarDate(holiday.date, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
