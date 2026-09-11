import { Mail, MapPin, Phone } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ClinicProfile } from '@clinic/contracts'
import { Card, CardContent, CardHeader, CardTitle } from '@clinic/ui'

export async function ClinicContactCard({
  clinic,
  title,
}: {
  clinic: ClinicProfile
  title?: string
}) {
  const t = await getTranslations('clinic')
  const phone = clinic.contact.phone
  const email = clinic.contact.email
  const address = [
    clinic.address.line1,
    clinic.address.line2,
    clinic.address.city,
    clinic.address.country,
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
          <div className="flex items-start gap-3">
            <Phone className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">{t('phone')}</dt>
              <dd className="font-medium">
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
          </div>
          <div className="flex items-start gap-3">
            <Mail className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">{t('email')}</dt>
              <dd className="truncate font-medium">
                {email ? (
                  <a href={`mailto:${email}`} className="text-primary hover:underline">
                    {email}
                  </a>
                ) : (
                  t('notProvided')
                )}
              </dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">{t('address')}</dt>
              <dd className="font-medium">{address || t('notProvided')}</dd>
            </div>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
