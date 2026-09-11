import { getLocale, getTranslations } from 'next-intl/server'
import type { ClinicProfile } from '@clinic/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'
import { WEEK_ORDER, weekdayName } from '@/lib/format/weekdays'

export async function ClinicHoursCard({ clinic }: { clinic: ClinicProfile }) {
  const [t, locale] = await Promise.all([getTranslations('clinic'), getLocale()])
  const branches = clinic.branches.filter((branch) => branch.isActive)

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
      </CardContent>
    </Card>
  )
}
