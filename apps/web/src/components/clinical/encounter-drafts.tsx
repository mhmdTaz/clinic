'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslations } from 'next-intl'
import type { ClinicalNote, EncounterDetail } from '@clinic/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from '@clinic/ui'
import type { LeaveAttempt } from '@/lib/navigation/navigation-guard'
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard'

/** The parts of a visit that are written as a draft and frozen by signing. */
export type DraftSectionId = 'note' | 'vitals' | 'diagnoses' | 'addendum'

interface SectionState {
  dirty: boolean
  saving: boolean
}

interface SectionHandle {
  /** Validates and saves; true once the server has it. Errors are shown by the section itself. */
  save(): Promise<boolean>
  /** Brings the section into view and puts the cursor in it. */
  focus(): void
}

export interface UnsavedSection {
  id: DraftSectionId
  label: string
  saving: boolean
}

interface Drafts {
  /** Sections with something typed that the server does not have yet, in page order. */
  unsaved: UnsavedSection[]
  /** The draft as the server last confirmed it: what signing would freeze. */
  revision: number
  savedNote: ClinicalNote
  report(id: DraftSectionId, state: SectionState, handle: SectionHandle): void
  forget(id: DraftSectionId): void
  /** Every write to the visit answers with the whole visit; the newest one is what was saved. */
  confirmed(encounter: EncounterDetail): void
  focus(id: DraftSectionId): void
}

const ORDER: readonly DraftSectionId[] = ['note', 'vitals', 'diagnoses', 'addendum']
/** An addendum is written after signing, so it never stands between a doctor and a signature. */
const SIGNING_SECTIONS: ReadonlySet<DraftSectionId> = new Set(['note', 'vitals', 'diagnoses'])

const DraftsContext = createContext<Drafts | null>(null)

/**
 * One visit's drafts, coordinated (audit F01, F02).
 *
 * The note, vitals and diagnoses each keep their own draft and save explicitly — ADR-0024's
 * reasons for not autosaving stand. What they did not have was a shared answer to two questions
 * that belong to the whole visit: may this be signed now, and may the doctor leave now? The
 * answer to both is "not while something typed here is not yet saved".
 */
export function EncounterDrafts({
  revision,
  note,
  children,
}: {
  revision: number
  note: ClinicalNote
  children: ReactNode
}) {
  const t = useTranslations('clinical.drafts')
  const tSections = useTranslations('clinical.drafts.sections')

  const [states, setStates] = useState<Partial<Record<DraftSectionId, SectionState>>>({})
  const handles = useRef(new Map<DraftSectionId, SectionHandle>())

  // The newest confirmed draft: from a save made here, or from a server render (a refresh after
  // another tab or device saved). Whichever revision is higher is the truth.
  const [latest, setLatest] = useState({ revision, note })
  if (revision > latest.revision) setLatest({ revision, note })

  const report = useCallback((id: DraftSectionId, state: SectionState, handle: SectionHandle) => {
    handles.current.set(id, handle)
    setStates((current) => {
      const before = current[id]
      if (before?.dirty === state.dirty && before.saving === state.saving) return current
      return { ...current, [id]: state }
    })
  }, [])

  const forget = useCallback((id: DraftSectionId) => {
    handles.current.delete(id)
    setStates((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  const confirmed = useCallback((encounter: EncounterDetail) => {
    setLatest((current) =>
      encounter.revision >= current.revision
        ? { revision: encounter.revision, note: encounter.note }
        : current,
    )
  }, [])

  const focus = useCallback((id: DraftSectionId) => handles.current.get(id)?.focus(), [])

  const unsaved = useMemo(
    () =>
      ORDER.filter((id) => states[id]?.dirty || states[id]?.saving).map((id) => ({
        id,
        label: tSections(id),
        saving: Boolean(states[id]?.saving),
      })),
    [states, tSections],
  )

  const value = useMemo<Drafts>(
    () => ({
      unsaved,
      revision: latest.revision,
      savedNote: latest.note,
      report,
      forget,
      confirmed,
      focus,
    }),
    [unsaved, latest, report, forget, confirmed, focus],
  )

  // ── Leaving with unsaved work ──────────────────────────────────────────────
  const [attempt, setAttempt] = useState<LeaveAttempt | null>(null)
  const [saving, setSaving] = useState(false)
  /** Where the cursor goes once the dialog has closed, instead of back to the link. */
  const focusAfterClose = useRef<DraftSectionId | null>(null)
  useLeaveGuard(unsaved.length > 0, setAttempt)

  async function saveAndLeave(current: LeaveAttempt) {
    setSaving(true)
    let failed: DraftSectionId | null = null
    // One at a time, in page order, stopping at the first that fails: what was saved stays
    // saved, and the doctor is left looking at the part that still needs them.
    for (const section of unsaved) {
      const handle = handles.current.get(section.id)
      if (!handle || !(await handle.save())) {
        failed = section.id
        break
      }
    }
    setSaving(false)
    if (failed !== null) focusAfterClose.current = failed
    setAttempt(null)
    if (failed === null) current.leave()
    else current.stay()
  }

  return (
    <DraftsContext.Provider value={value}>
      {children}
      <Dialog
        open={attempt !== null}
        onOpenChange={(open) => {
          if (open || saving || !attempt) return
          attempt.stay()
          setAttempt(null)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            const section = focusAfterClose.current
            if (section === null) return
            focusAfterClose.current = null
            event.preventDefault()
            handles.current.get(section)?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('leaveTitle')}</DialogTitle>
            <DialogDescription>{t('leaveDescription')}</DialogDescription>
          </DialogHeader>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
            {unsaved.map((section) => (
              <li key={section.id}>{section.label}</li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                attempt?.stay()
                setAttempt(null)
              }}
            >
              {t('stay')}
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                disabled={saving}
                onClick={() => {
                  const current = attempt
                  setAttempt(null)
                  current?.leave()
                }}
              >
                {t('discardAndLeave')}
              </Button>
              <Button disabled={saving} onClick={() => attempt && void saveAndLeave(attempt)}>
                {saving ? <Spinner /> : null}
                {saving ? t('saving') : t('saveAndLeave')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DraftsContext.Provider>
  )
}

function useDrafts(): Drafts | null {
  return useContext(DraftsContext)
}

/**
 * A section's part in the visit's drafts. Outside an {@link EncounterDrafts} (a form reused
 * elsewhere) it does nothing, and the form behaves as it always did.
 */
export function useDraftSection(
  id: DraftSectionId,
  state: SectionState,
  handle: SectionHandle,
): { confirmed(encounter: EncounterDetail): void } {
  const drafts = useDrafts()
  const handleRef = useRef(handle)
  handleRef.current = handle
  // Stable wrappers, so reporting does not re-render the page on every keystroke.
  const stable = useMemo<SectionHandle>(
    () => ({ save: () => handleRef.current.save(), focus: () => handleRef.current.focus() }),
    [],
  )

  const report = drafts?.report
  const forget = drafts?.forget
  useEffect(() => {
    report?.(id, { dirty: state.dirty, saving: state.saving }, stable)
  }, [report, id, state.dirty, state.saving, stable])
  useEffect(() => () => forget?.(id), [forget, id])

  const confirmed = drafts?.confirmed
  return useMemo(() => ({ confirmed: (encounter) => confirmed?.(encounter) }), [confirmed])
}

/** What signing needs to know: whether it may happen, and what it would freeze. */
export function useSigningReadiness(): {
  blocking: UnsavedSection[]
  revision: number | undefined
  savedNote: ClinicalNote | null
  focus(id: DraftSectionId): void
} {
  const drafts = useDrafts()
  return {
    blocking: drafts?.unsaved.filter((section) => SIGNING_SECTIONS.has(section.id)) ?? [],
    revision: drafts?.revision,
    savedNote: drafts?.savedNote ?? null,
    focus: (id) => drafts?.focus(id),
  }
}
