import { Text, View } from 'react-native'
import type { Allergy, ChronicCondition } from '@clinic/contracts'
import { Badge, palette } from '~/components/ui'
import {
  activeConditions,
  allergiesWorstFirst,
  allergyText,
  hasSevereAllergy,
} from '~/lib/clinical'
import { formatCalendarDate } from '~/lib/format'

/**
 * The chart banner (D4) — first on the chart and on the note, because it is the part that prevents
 * harm.
 *
 * **"None recorded", never "No allergies".** An empty list means nobody has written one down, which
 * is not the same as the patient having none, and a doctor prescribing from a phone must not be
 * told the second when the record only knows the first. The web's wording, for the same reason.
 */
export function ChartBanner({
  allergies,
  conditions,
}: {
  allergies: readonly Allergy[]
  conditions: readonly ChronicCondition[]
}) {
  const severe = hasSevereAllergy(allergies)
  const active = activeConditions(conditions)

  return (
    <View
      accessibilityLabel="Allergies and chronic conditions"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: severe ? palette.danger : palette.border,
        backgroundColor: severe ? palette.dangerSoft : palette.card,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '600', color: severe ? palette.danger : palette.text }}>
          {severe ? '⚠ Allergies' : 'Allergies'}
        </Text>
        {allergies.length === 0 ? (
          <Text style={{ color: palette.muted }}>None recorded</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {allergiesWorstFirst(allergies).map((allergy) => (
              <Badge
                key={allergy.id}
                label={allergyText(allergy)}
                tone={
                  allergy.severity === 'SEVERE'
                    ? 'danger'
                    : allergy.severity === 'MODERATE'
                      ? 'warning'
                      : 'neutral'
                }
              />
            ))}
          </View>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={{ fontWeight: '600', color: palette.text }}>Chronic conditions</Text>
        {active.length === 0 ? (
          <Text style={{ color: palette.muted }}>None recorded</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {active.map((condition) => (
              <Badge
                key={condition.id}
                label={[
                  condition.code ? `${condition.code} · ` : '',
                  condition.description,
                  condition.diagnosedAt
                    ? ` (${formatCalendarDate(condition.diagnosedAt, 'short')})`
                    : '',
                ].join('')}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  )
}
