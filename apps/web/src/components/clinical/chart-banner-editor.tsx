'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ALLERGY_SEVERITIES } from '@clinic/config'
import {
  SetAllergiesRequest,
  SetConditionsRequest,
  type AllergySeverity,
  type ChartBanner,
} from '@clinic/contracts'
import {
  Alert,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

interface AllergyRow {
  key: string
  substance: string
  reaction: string
  severity: AllergySeverity
}
interface ConditionRow {
  key: string
  code: string
  description: string
  diagnosedAt: string
}

let sequence = 0
const rowKey = () => `row-${(sequence += 1)}`

/**
 * Editing the chart banner (D4).
 *
 * Both lists are replaced whole rather than patched row by row: "these are the things this person
 * reacts to" is one statement, and a partial write is how a list ends up saying something nobody
 * meant. The two saves are sequential so a failure on the second leaves the first applied and
 * says so, rather than silently half-writing the banner.
 */
export function ChartBannerEditor({
  patientId,
  banner,
}: {
  patientId: string
  banner: ChartBanner
}) {
  const t = useTranslations('clinical.chart')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()

  const [open, setOpen] = useState(false)
  const [allergies, setAllergies] = useState<AllergyRow[]>([])
  const [conditions, setConditions] = useState<ConditionRow[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setAllergies(
      banner.allergies.map((allergy) => ({
        key: rowKey(),
        substance: allergy.substance,
        reaction: allergy.reaction ?? '',
        severity: allergy.severity,
      })),
    )
    setConditions(
      banner.chronicConditions.map((condition) => ({
        key: rowKey(),
        code: condition.code ?? '',
        description: condition.description,
        diagnosedAt: condition.diagnosedAt ?? '',
      })),
    )
    setError(null)
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const parsedAllergies = SetAllergiesRequest.safeParse({
        allergies: allergies
          .filter((row) => row.substance.trim() !== '')
          .map((row) => ({
            substance: row.substance,
            reaction: row.reaction || null,
            severity: row.severity,
          })),
      })
      const parsedConditions = SetConditionsRequest.safeParse({
        conditions: conditions
          .filter((row) => row.description.trim() !== '')
          .map((row) => ({
            code: row.code || null,
            description: row.description,
            diagnosedAt: row.diagnosedAt || null,
            resolvedAt: null,
          })),
      })
      if (!parsedAllergies.success || !parsedConditions.success) {
        throw new ApiError(400, 'VALIDATION_FAILED', '')
      }

      await apiFetch(`/api/v1/patients/${patientId}/allergies`, {
        method: 'PUT',
        body: parsedAllergies.data,
      })
      await apiFetch(`/api/v1/patients/${patientId}/conditions`, {
        method: 'PUT',
        body: parsedConditions.data,
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
        if (next) load()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('allergies')}</h3>
            {allergies.map((row, index) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  value={row.substance}
                  maxLength={120}
                  aria-label={t('substance')}
                  placeholder={t('substance')}
                  className="min-w-40 flex-1"
                  onChange={(event) =>
                    setAllergies((rows) =>
                      rows.map((entry, at) =>
                        at === index ? { ...entry, substance: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Input
                  value={row.reaction}
                  maxLength={200}
                  aria-label={t('reaction')}
                  placeholder={t('reaction')}
                  className="min-w-40 flex-1"
                  onChange={(event) =>
                    setAllergies((rows) =>
                      rows.map((entry, at) =>
                        at === index ? { ...entry, reaction: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Select
                  value={row.severity}
                  aria-label={t('severity')}
                  className="w-36"
                  onChange={(event) =>
                    setAllergies((rows) =>
                      rows.map((entry, at) =>
                        at === index
                          ? { ...entry, severity: event.target.value as AllergySeverity }
                          : entry,
                      ),
                    )
                  }
                >
                  {ALLERGY_SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {t(`severities.${severity}`)}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('removeAllergy', { substance: row.substance || t('substance') })}
                  onClick={() => setAllergies((rows) => rows.filter((_, at) => at !== index))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setAllergies((rows) => [
                  ...rows,
                  { key: rowKey(), substance: '', reaction: '', severity: 'UNKNOWN' },
                ])
              }
            >
              {t('addAllergy')}
            </Button>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('conditions')}</h3>
            {conditions.map((row, index) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  value={row.description}
                  maxLength={200}
                  aria-label={t('condition')}
                  placeholder={t('condition')}
                  className="min-w-40 flex-1"
                  onChange={(event) =>
                    setConditions((rows) =>
                      rows.map((entry, at) =>
                        at === index ? { ...entry, description: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Input
                  value={row.code}
                  maxLength={16}
                  aria-label={t('code')}
                  placeholder={t('code')}
                  className="w-28"
                  onChange={(event) =>
                    setConditions((rows) =>
                      rows.map((entry, at) =>
                        at === index ? { ...entry, code: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Input
                  type="date"
                  value={row.diagnosedAt}
                  aria-label={t('diagnosedAt')}
                  className="w-40"
                  onChange={(event) =>
                    setConditions((rows) =>
                      rows.map((entry, at) =>
                        at === index ? { ...entry, diagnosedAt: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('removeCondition', {
                    condition: row.description || t('condition'),
                  })}
                  onClick={() => setConditions((rows) => rows.filter((_, at) => at !== index))}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              id={`${fieldId}-add-condition`}
              onClick={() =>
                setConditions((rows) => [
                  ...rows,
                  { key: rowKey(), code: '', description: '', diagnosedAt: '' },
                ])
              }
            >
              {t('addCondition')}
            </Button>
          </section>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending} onClick={() => void save()}>
            {pending ? <Spinner /> : null}
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
