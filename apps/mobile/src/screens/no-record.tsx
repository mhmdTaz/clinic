import { Body, Screen, Title } from '~/components/ui'

/**
 * An account holding a portal with no profile behind it (ADR-0004): the patient portal with no
 * patient record, or the doctor portal with no doctor profile.
 *
 * It happens — an invitation accepted before the desk linked the record — and every screen in the
 * portal starts from that profile. Saying so plainly is kinder than a screen of refusals. The
 * wording is the web's (`scheduling.noPatientProfile`, `scheduling.askAnAdmin`).
 */
export function NoPatientRecord() {
  return (
    <Screen>
      <Title>No patient record yet</Title>
      <Body>
        Your account is not linked to a record at this clinic. An administrator can connect them.
      </Body>
    </Screen>
  )
}

export function NoDoctorProfile() {
  return (
    <Screen>
      <Title>No doctor profile yet</Title>
      <Body>
        Your account is not linked to a record at this clinic. An administrator can connect them.
      </Body>
    </Screen>
  )
}
