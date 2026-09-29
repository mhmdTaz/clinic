import { Mail, MapPin, Phone } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ClinicProfile } from '@clinic/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'
import { countryName } from '@/lib/format/regions'

export async function ClinicContactCard({
  clinic,
  title,
}: {
  clinic: ClinicProfile
  title?: string
}) {
  const [t, locale] = await Promise.all([getTranslations('clinic'), getLocale()])
  const phone = clinic.contact.phone
  const email = clinic.contact.email
  const address = [
    clinic.address.line1,
    clinic.address.line2,
    clinic.address.city,
    countryName(clinic.address.country, locale),
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? t('contactTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-4 text-sm">
          <div className="min-w-0">
            <dt className="text-muted-foreground flex items-center gap-2 text-xs">
              <Phone className="size-4 shrink-0" aria-hidden="true" />
              {t('phone')}
            </dt>
            <dd className="ps-6 font-medium">
              {phone ? (
                <a
                  href={`tel:${phone.replaceAll(' ', '')}`}
                  className="text-primary hover:underline"
                >
                  {phone}
                </a>
              ) : (
                t('notProvided')
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground flex items-center gap-2 text-xs">
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              {t('email')}
            </dt>
            <dd className="truncate ps-6 font-medium">
              {email ? (
                <a href={`mailto:${email}`} className="text-primary hover:underline">
                  {email}
                </a>
              ) : (
                t('notProvided')
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground flex items-center gap-2 text-xs">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {t('address')}
            </dt>
            <dd className="ps-6 font-medium">{address || t('notProvided')}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
