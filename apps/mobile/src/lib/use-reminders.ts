import { useCallback, useEffect, useState } from 'react'
import { portal } from './api'
import { messageFor } from './errors'
import { enrolForPush, forgetOptIn, optedInToken, rememberOptIn } from './push'

export type ReminderProblem =
  { kind: 'denied' } | { kind: 'unsupported'; reason: string } | { kind: 'failed'; message: string }

/**
 * Whether this phone gets reminders, and the switch that changes it.
 *
 * The switch reflects the **opt-in kept on this phone**, not a guess from the device list: the
 * first version asked the server which device was "this one" without ever telling it the token, so
 * the answer was always no and the switch always showed off.
 *
 * Shared by the account screen and the booking confirmation — the two moments somebody has a
 * reason to say yes, and the only two places the app ever asks.
 */
export function useReminders() {
  const [on, setOn] = useState(false)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void optedInToken().then((token) => {
      if (cancelled) return
      setOn(token !== null)
      setKnown(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const change = useCallback(async (next: boolean): Promise<ReminderProblem | null> => {
    setBusy(true)
    try {
      if (!next) {
        const token = await optedInToken()
        if (token) {
          const devices = await portal.myDevices(token)
          const mine = devices.find((device) => device.isThisDevice)
          if (mine) await portal.removeDevice(mine.id)
        }
        await forgetOptIn()
        setOn(false)
        return null
      }

      const enrolment = await enrolForPush()
      if (enrolment.status === 'denied') return { kind: 'denied' }
      if (enrolment.status === 'unsupported') {
        return { kind: 'unsupported', reason: enrolment.reason }
      }

      await portal.registerDevice(enrolment.registration)
      await rememberOptIn(enrolment.registration.token)
      setOn(true)
      return null
    } catch (caught) {
      return { kind: 'failed', message: messageFor(caught) }
    } finally {
      setBusy(false)
    }
  }, [])

  return { on, known, busy, change }
}

/** What to say when the switch could not be moved. */
export function reminderProblemText(problem: ReminderProblem): { title: string; message: string } {
  switch (problem.kind) {
    case 'denied':
      // Specific, because the app cannot ask again: the only way back is the phone's Settings.
      return {
        title: 'Notifications are switched off',
        message:
          'Turn them on for this app in your phone’s Settings to get appointment reminders here.',
      }
    case 'unsupported':
      return { title: 'Not available here', message: problem.reason }
    case 'failed':
      return { title: 'Reminders could not be changed', message: problem.message }
  }
}
