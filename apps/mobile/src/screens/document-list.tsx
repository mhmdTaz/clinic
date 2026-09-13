import { useState } from 'react'
import { Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import type { DownloadLink, StoredFile } from '@clinic/contracts'
import { Badge, Button, Card, Muted, inform, palette } from '~/components/ui'
import { messageFor } from '~/lib/errors'
import { fileCategoryLabel, formatBytes, formatWhen } from '~/lib/format'

/**
 * A list of stored documents, each opened on demand — the patient's vault and a chart's files.
 *
 * **Opened, never downloaded to the phone.** Each tap asks for a sixty-second link and opens it in
 * the system's in-app browser. Saving the file into the app would put a lab result on the device
 * outside the vault's encryption, for the benefit of reading it offline — exactly the trade the
 * offline allowlist refuses (`offline.ts`).
 */
export function DocumentList({
  files,
  timeZone,
  disabled,
  linkFor,
}: {
  files: readonly StoredFile[]
  timeZone: string
  /** Offline: a link needs the server, so nothing can be opened. */
  disabled: boolean
  linkFor: (fileId: string) => Promise<DownloadLink>
}) {
  const [opening, setOpening] = useState<string | null>(null)

  async function open(file: StoredFile) {
    setOpening(file.id)
    try {
      // A fresh link per tap. One kept from an earlier tap would have expired, and a link that
      // outlives the permission behind it is a credential with no owner (§12.1).
      const link = await linkFor(file.id)
      await WebBrowser.openBrowserAsync(link.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      })
    } catch (caught) {
      inform('That document could not be opened', messageFor(caught))
    } finally {
      setOpening(null)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {files.map((file) => (
        <Card key={file.id}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text }}>
            {file.fileName}
          </Text>
          <Badge label={fileCategoryLabel(file.category)} />
          {file.description ? <Muted>{file.description}</Muted> : null}
          <Muted>
            {[
              formatBytes(file.sizeBytes),
              file.createdAt ? formatWhen(file.createdAt, timeZone) : null,
              file.uploadedBy?.name,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
          {file.status === 'CLEAN' ? (
            <Button
              label="Open"
              tone="plain"
              pending={opening === file.id}
              disabled={disabled || (opening !== null && opening !== file.id)}
              accessibilityHint={`Opens ${file.fileName}`}
              onPress={() => void open(file)}
            />
          ) : file.status === 'PENDING' || file.status === 'SCANNING' ? (
            // Only a scanned, clean file can be opened (§12.1); the other states say why.
            <Muted>Still being checked. It can be opened once that is done.</Muted>
          ) : (
            <Badge label="Cannot be opened. Ask the clinic for another copy." tone="danger" />
          )}
        </Card>
      ))}
    </View>
  )
}
