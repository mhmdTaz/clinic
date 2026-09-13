import { Redirect } from 'expo-router'
import { homeOf, landingPortal } from '~/lib/routes'
import { useSession } from '~/lib/session'

/**
 * `/` — a door, not a destination. A signed-in person goes to their portal's home (§10.1); anyone
 * else is sent to sign in by the gate in the root layout.
 */
export default function Index() {
  const { state } = useSession()
  if (state.status !== 'signedIn') return null
  const landing = landingPortal(state.user)
  return landing ? <Redirect href={homeOf(landing) as '/patient' | '/doctor'} /> : null
}
