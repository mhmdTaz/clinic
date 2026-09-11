import type { ReactNode } from 'react'
import { env } from '@clinic/config'
import { getClinicSessionInfo } from '@clinic/core/clinic'

export const dynamic = 'force-dynamic'

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const clinic = await getClinicSessionInfo(env().CLINIC_ID)

  return (
    <main className="bg-muted flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="text-muted-foreground mb-6 text-center text-xs font-semibold tracking-widest uppercase">
          {clinic.name}
        </p>
        {children}
      </div>
    </main>
  )
}
