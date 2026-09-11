import { APP_VERSION } from '@clinic/config'
import { getClinicOverview } from '@clinic/core/clinic'
import { checkHealth } from '@clinic/core/health'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clinic/ui'

export const dynamic = 'force-dynamic'

const SEEDED_CLINIC_ID = 'seed_clinic_demo'

/**
 * The walking skeleton (Phase 0).
 *
 * A Server Component calling a use case directly — no fetch, no API round trip, and
 * no database access in this file. The same use case backs the REST endpoint the
 * mobile app will call. This page exists to prove the wiring end to end, and Phase 1
 * replaces it with the real login and portal shell.
 */
export default async function HomePage() {
  const health = await checkHealth(APP_VERSION)
  const clinic = await getClinicOverview(SEEDED_CLINIC_ID).catch(() => null)

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
          Clinic platform
        </p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Phase 0 — Foundations</h1>
        <p className="text-muted-foreground text-sm">
          Monorepo, tooling and the walking skeleton. Nothing here is a real feature yet; it exists
          to prove that a page, a use case, a repository and the database are wired together.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>System health</CardTitle>
            <Badge tone={health.status === 'ok' ? 'success' : 'danger'}>
              {health.status === 'ok' ? 'All systems up' : 'Degraded'}
            </Badge>
          </div>
          <CardDescription>
            Also served as JSON at <code className="font-mono text-xs">/api/health</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {health.dependencies.map((dep) => (
            <div
              key={dep.name}
              className="bg-muted flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2"
            >
              <span className="font-mono text-sm">{dep.name}</span>
              <span className="flex items-center gap-3">
                {dep.detail ? (
                  <span className="text-muted-foreground text-xs">{dep.detail}</span>
                ) : null}
                {dep.latencyMs !== null ? (
                  <span className="text-muted-foreground text-xs">{dep.latencyMs}ms</span>
                ) : null}
                <Badge tone={dep.status === 'up' ? 'success' : 'danger'}>{dep.status}</Badge>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seeded clinic</CardTitle>
          <CardDescription>
            Read through <code className="font-mono text-xs">getClinicOverview()</code> — a use case
            in <code className="font-mono text-xs">packages/core</code> that has never heard of
            Next.js.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clinic ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Name" value={clinic.name} />
              <Field label="Timezone" value={clinic.timezone} />
              <Field label="Currency" value={clinic.currency} />
              <Field label="Locale" value={clinic.locale} />
              <Field label="Users" value={String(clinic.counts.users)} />
              <Field label="Roles" value={String(clinic.counts.roles)} />
              <Field
                label="Branches"
                value={clinic.branches.map((b) => b.name).join(', ') || 'none'}
              />
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">
              No seeded clinic found. Run{' '}
              <code className="font-mono text-xs">pnpm db:migrate &amp;&amp; pnpm db:seed</code>.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}
