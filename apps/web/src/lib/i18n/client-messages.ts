/**
 * The part of the catalogue client components read (audit, performance).
 *
 * Every page used to carry the whole catalogue to the browser — about 60 KB of JSON, serialised
 * into the HTML — although most of it is text that server components render themselves and the
 * browser never looks up: page titles, headings, the permission catalogue, navigation labels.
 * Only these namespaces are sent. Each entry is the narrowest subtree a client component asks for
 * (`useTranslations('clinical.note')` needs `clinical.note`, not all of `clinical`).
 *
 * A test (client-messages.test.ts) reads every client component and fails if one asks for a
 * namespace this list does not cover, so a new component cannot quietly render a key name.
 */
export const CLIENT_NAMESPACES: readonly string[] = [
  'account',
  'admin.audit.chain',
  'admin.clinic.booking',
  'admin.clinic.holidays',
  'admin.clinic.hours',
  'admin.clinic.locations',
  'admin.clinic.profile',
  'admin.dental.quickPickForm',
  'admin.dental.scopes',
  'admin.dental.treatmentForm',
  'admin.dental.voice',
  'admin.roles.detail',
  'admin.roles.new',
  'admin.services.form',
  'admin.users.detail',
  'admin.users.new',
  'auth',
  'billing.invoice',
  'billing.methods',
  'billing.payment',
  'billing.refund',
  'bloodTypes',
  'clinical.chart',
  'clinical.diagnoses',
  'clinical.drafts',
  'clinical.files',
  'clinical.note',
  'clinical.prescriptions',
  'clinical.vitals',
  'common',
  'dataTable',
  // The tooth chart, plans, lab work and voice charting are client-side almost throughout.
  'dental',
  'duplicateReasons',
  'errorPage',
  'errors',
  'genders',
  'inventory.adjust',
  'inventory.consume',
  'inventory.item.form',
  'inventory.receive',
  'notifications',
  'password',
  'patient.appointments.new',
  'scheduling',
  'scopes',
  'shell',
  'staff.doctors',
  'staff.patients',
  'support.categories',
  'support.open',
  'support.priorities',
  'support.reply',
  'support.statuses',
  'support.triage',
  'validation',
]

type Catalogue = Record<string, unknown>

/** The subtrees `namespaces` name, copied out of `messages`; a missing one is skipped. */
export function pickMessages(messages: Catalogue, namespaces: readonly string[]): Catalogue {
  const picked: Catalogue = {}
  for (const namespace of namespaces) {
    const path = namespace.split('.')
    let source: unknown = messages
    for (const key of path) {
      source = source && typeof source === 'object' ? (source as Catalogue)[key] : undefined
    }
    if (source === undefined) continue
    let target = picked
    path.forEach((key, index) => {
      if (index === path.length - 1) target[key] = source
      else target = (target[key] ??= {}) as Catalogue
    })
  }
  return picked
}
