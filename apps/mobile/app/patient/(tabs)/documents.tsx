import { RefreshControl, ScrollView } from 'react-native'
import { Muted, QueryState, Screen, Truncated } from '~/components/ui'
import { portal } from '~/lib/api'
import { useMyDocuments } from '~/lib/queries'
import { useIsOffline, useUser } from '~/lib/session'
import { DocumentList } from '~/screens/document-list'
import { NoPatientRecord } from '~/screens/no-record'

/**
 * The document vault (P8): everything the clinic chose to share.
 *
 * The server's scope does the filtering — an OWN grant reaches the patient's own documents and
 * only those flagged visible (ADR-0025) — so this screen has no rule of its own to get wrong.
 */
export default function PatientDocuments() {
  const user = useUser()
  const offline = useIsOffline()
  const query = useMyDocuments(user.patientId)

  if (!user.patientId) return <NoPatientRecord />

  return (
    <ScrollView
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
      }
    >
      <Screen>
        <Muted>Everything the clinic has shared with you.</Muted>
        <QueryState
          query={query}
          isEmpty={(files) => files.items.length === 0}
          emptyText="Documents your clinic shares with you appear here."
        >
          {(files) => (
            <>
              <DocumentList
                files={files.items}
                timeZone={user.clinic.timezone}
                disabled={offline}
                linkFor={(fileId) => portal.downloadLink(fileId)}
              />
              <Truncated listed={files} />
            </>
          )}
        </QueryState>
      </Screen>
    </ScrollView>
  )
}
