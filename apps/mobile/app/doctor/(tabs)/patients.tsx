import { useMemo, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { localDateIn } from '@clinic/contracts'
import { Field, Muted, QueryState, Row, Screen } from '~/components/ui'
import { ageOn } from '~/lib/format'
import { useCaseload } from '~/lib/queries'
import { useUser } from '~/lib/session'
import { NoDoctorProfile } from '~/screens/no-record'

/**
 * My patients (D2): everyone this doctor has treated, most recent first.
 *
 * Searched on the phone rather than on the server. The list is one doctor's caseload, which is
 * bounded by how many people one doctor can see, and a search box that waits on the network
 * between each letter is unusable on a weak signal.
 */
export default function DoctorPatients() {
  const user = useUser()
  const router = useRouter()
  const query = useCaseload()
  const [search, setSearch] = useState('')
  const today = localDateIn(user.clinic.timezone)

  const term = search.trim().toLowerCase()
  const matches = useMemo(
    () =>
      (query.data ?? []).filter(
        (patient) =>
          term === '' ||
          `${patient.firstName} ${patient.lastName}`.toLowerCase().includes(term) ||
          patient.medicalRecordNo.toLowerCase().includes(term),
      ),
    [query.data, term],
  )

  if (!user.doctorId) return <NoDoctorProfile />

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Screen>
        <Muted>Everyone you have seen, most recent first.</Muted>
        <Field
          nativeID="caseload-search"
          label="Find a patient"
          placeholder="Name or record number"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />

        <QueryState
          query={query}
          isEmpty={(patients) => patients.length === 0}
          emptyText="No patients yet. A patient appears here once you have recorded a visit with them."
        >
          {() =>
            matches.length === 0 ? (
              <Muted>{`Nobody on your list matches “${search.trim()}”.`}</Muted>
            ) : (
              <View style={{ gap: 8 }}>
                {matches.map((patient) => {
                  const age = patient.dateOfBirth ? ageOn(patient.dateOfBirth, today) : null
                  return (
                    <Row
                      key={patient.id}
                      title={`${patient.firstName} ${patient.lastName}`}
                      subtitle={[
                        patient.medicalRecordNo,
                        age === null ? null : age === 1 ? '1 year' : `${age} years`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      onPress={() =>
                        router.push({
                          pathname: '/doctor/patients/[patientId]',
                          params: { patientId: patient.id },
                        })
                      }
                    />
                  )
                })}
              </View>
            )
          }
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
