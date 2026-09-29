'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import type {
  DentalChart as Chart,
  DentalTreatment,
  Dentition,
  LabOrder,
  QuickPick,
} from '@clinic/contracts'
import { Alert, Button, Label, Select, Skeleton, cn } from '@clinic/ui'
import { apiFetch } from '@/lib/api/client'
import type { VoiceDraft } from '@/lib/dental/voice'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'
import { Odontogram2D } from './odontogram-2d'
import { ToothPanel, type Visit } from './tooth-panel'
import { filterTeeth, type ChartFilter } from './tooth-visual'
import { VoiceButton } from './voice-button'

// three.js and the tooth meshes arrive only when somebody opens the 3D view.
const Jaw3D = dynamic(() => import('./jaw-3d').then((module) => module.Jaw3D), {
  ssr: false,
  loading: () => <Skeleton className="h-[504px] w-full rounded-lg" />,
})

type Mode = '3d' | '2d'
const MODE_KEY = 'clinic.dentalChart.mode'

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === '2d' ? '2d' : '3d'
  } catch {
    return '3d'
  }
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * The tooth chart card (Phase 11): the 3D jaw or the flat chart, one selected tooth shared by
 * both, and that tooth's history beside them.
 *
 * The picture is the server's: every write refreshes the page's data rather than patching a copy
 * here, so what is drawn is always what the log says. Replaying an earlier day asks the server
 * for the chart as it stood then, and while it is shown nothing can be written.
 */
export function DentalChart({
  patientId,
  chart: current,
  treatments,
  quickPicks,
  visits,
  defaultVisitId,
  today,
  canWrite,
  files,
  labOrders = [],
  voice = false,
}: {
  patientId: string
  chart: Chart
  treatments: DentalTreatment[]
  quickPicks: QuickPick[]
  visits: Visit[]
  defaultVisitId: string | null
  today: string
  canWrite: boolean
  files: { canRead: boolean; canUpload: boolean }
  /** The patient's open lab work (Phase 13): a chip on each tooth it names. */
  labOrders?: readonly LabOrder[]
  /** The clinic has turned voice charting on (ADR-0037). */
  voice?: boolean
}) {
  const t = useTranslations('dental')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  // A new function every render: read through a ref, so the replay fetch does not re-run on it.
  const describe = useRef(errorMessage)
  describe.current = errorMessage

  const [mode, setModeState] = useState<Mode>('2d')
  const [webgl, setWebgl] = useState(true)
  const [opened3d, setOpened3d] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState<ChartFilter>('all')
  const [asOf, setAsOf] = useState<string | null>(null)
  const [past, setPast] = useState<Chart | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingDentition, setSavingDentition] = useState(false)
  // A voice draft, keyed so a second sentence about the same tooth opens a fresh form.
  const [draft, setDraft] = useState<(VoiceDraft & { key: number }) | null>(null)

  // Read after mount: the server has no window, and a mismatch would flash the wrong view.
  useEffect(() => {
    const supported = hasWebGL()
    setWebgl(supported)
    const preferred = supported ? readMode() : '2d'
    setModeState(preferred)
    if (preferred === '3d') setOpened3d(true)
  }, [])

  const setMode = (next: Mode) => {
    setModeState(next)
    if (next === '3d') setOpened3d(true)
    try {
      window.localStorage.setItem(MODE_KEY, next)
    } catch {
      // A private window may refuse storage; the choice simply is not remembered.
    }
  }

  const shown = asOf && past ? past : current
  const replaying = asOf !== null

  useEffect(() => {
    if (!asOf) {
      setPast(null)
      return
    }
    let cancelled = false
    setError(null)
    apiFetch<Chart>(`/api/v1/patients/${patientId}/dental-chart?asOf=${asOf}`)
      .then((chart) => (cancelled ? null : setPast(chart)))
      .catch((caught: unknown) => (cancelled ? null : setError(describe.current(caught))))
    return () => {
      cancelled = true
    }
  }, [asOf, patientId])

  const teeth = useMemo(
    () => filterTeeth(shown.teeth, filter, shown.lastCharted?.performedOn ?? null),
    [shown, filter],
  )
  const highlight = useMemo(
    () => (replaying ? [] : (current.lastCharted?.teeth ?? [])),
    [replaying, current.lastCharted],
  )
  const selectedTooth = shown.teeth.find((tooth) => tooth.fdi === selected) ?? null
  const chartOrder = useMemo(() => shown.teeth.map((tooth) => tooth.fdi), [shown.teeth])

  const toothLabel = useCallback(
    (fdi: string) => {
      const quadrant = Number(fdi[0])
      const primary = quadrant >= 5
      return t('tooth', {
        fdi,
        place: t(`quadrants.${primary ? quadrant - 4 : quadrant}`),
        name: t(`${primary ? 'primaryNames' : 'names'}.${fdi[1]}`),
      })
    },
    [t],
  )

  async function changeDentition(next: Dentition) {
    setSavingDentition(true)
    setError(null)
    try {
      await apiFetch(`/api/v1/patients/${patientId}/dental-chart/dentition`, {
        method: 'PUT',
        body: { dentition: next },
      })
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSavingDentition(false)
    }
  }

  // 3D draws one set of teeth at a time; a mixed mouth is read on the flat chart.
  const threeD = shown.dentition === 'MIXED' ? null : shown.dentition
  const effectiveMode: Mode = mode === '3d' && webgl && threeD ? '3d' : '2d'
  const stops = shown.history
  const stopIndex = asOf ? stops.indexOf(asOf) : stops.length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t('viewLabel')} className="inline-flex">
          <Button
            size="sm"
            variant={effectiveMode === '3d' ? 'secondary' : 'outline'}
            aria-pressed={effectiveMode === '3d'}
            disabled={!webgl || !threeD}
            title={!webgl ? t('noWebgl') : !threeD ? t('mixedIs2d') : undefined}
            className="rounded-r-none"
            onClick={() => setMode('3d')}
          >
            {t('view3d')}
          </Button>
          <Button
            size="sm"
            variant={effectiveMode === '2d' ? 'secondary' : 'outline'}
            aria-pressed={effectiveMode === '2d'}
            className="-ml-px rounded-l-none"
            onClick={() => setMode('2d')}
          >
            {t('view2d')}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="dental-filter" className="text-xs">
            {t('filters.label')}
          </Label>
          <Select
            id="dental-filter"
            value={filter}
            className="h-9 w-auto"
            onChange={(event) => setFilter(event.target.value as ChartFilter)}
          >
            <option value="all">{t('filters.all')}</option>
            <option value="todo">{t('filters.todo')}</option>
            <option value="done">{t('filters.done')}</option>
            <option value="lastCharted">{t('filters.lastCharted')}</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="dental-dentition" className="text-xs">
            {t('dentition.label')}
          </Label>
          <Select
            id="dental-dentition"
            value={current.dentition}
            className="h-9 w-auto"
            disabled={!canWrite || savingDentition || replaying}
            onChange={(event) => void changeDentition(event.target.value as Dentition)}
          >
            <option value="PERMANENT">{t('dentition.PERMANENT')}</option>
            <option value="MIXED">{t('dentition.MIXED')}</option>
            <option value="PRIMARY">{t('dentition.PRIMARY')}</option>
          </Select>
        </div>

        {voice && canWrite && !replaying ? (
          <VoiceButton
            treatments={treatments}
            onDraft={(heard) => {
              setSelected(heard.fdi)
              setDraft({ ...heard, key: Date.now() })
            }}
          />
        ) : null}

        <div className="text-muted-foreground ml-auto flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-[#185FA5]" />
            {t('legend.done')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-[#E24B4A]" />
            {t('legend.todo')}
          </span>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {replaying ? (
        <Alert tone="info" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('replay.showing', { date: asOf })}</span>
          <Button size="sm" variant="outline" onClick={() => setAsOf(null)}>
            {t('replay.backToToday')}
          </Button>
        </Alert>
      ) : current.lastCharted ? (
        <p className="text-muted-foreground text-sm">
          {t('lastCharted', {
            date: current.lastCharted.performedOn,
            teeth: current.lastCharted.teeth.join(', '),
          })}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">{t('nothingYet')}</p>
      )}

      <div className="@container">
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          <div className="flex min-w-0 flex-col gap-3">
            {opened3d && threeD ? (
              <div className={cn(effectiveMode !== '3d' && 'hidden')}>
                <Jaw3D
                  dentition={threeD}
                  teeth={teeth}
                  selected={selected}
                  highlight={highlight}
                  active={effectiveMode === '3d'}
                  onSelect={setSelected}
                  toothLabel={toothLabel}
                />
              </div>
            ) : null}
            {effectiveMode === '2d' ? (
              <div className="bg-card rounded-lg border p-2">
                <Odontogram2D
                  dentition={shown.dentition}
                  teeth={teeth}
                  selected={selected}
                  highlight={highlight}
                  onSelect={setSelected}
                  toothLabel={toothLabel}
                  labels={{
                    right: t('sides.right'),
                    left: t('sides.left'),
                    upper: t('jaws.upper'),
                    lower: t('jaws.lower'),
                    chart: t('chartLabel'),
                  }}
                />
              </div>
            ) : null}

            {stops.length > 0 ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="dental-history">
                  {t('replay.label', { date: asOf ?? t('replay.today') })}
                </Label>
                <input
                  id="dental-history"
                  type="range"
                  min={0}
                  max={stops.length}
                  step={1}
                  value={stopIndex === -1 ? stops.length : stopIndex}
                  className="accent-primary w-full"
                  aria-valuetext={asOf ?? t('replay.today')}
                  onChange={(event) => {
                    const index = Number(event.target.value)
                    setAsOf(index >= stops.length ? null : stops[index]!)
                  }}
                />
                <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
                  <span>{stops[0]}</span>
                  <span>{t('replay.today')}</span>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="bg-card rounded-lg border p-4" aria-live="polite">
            {selectedTooth ? (
              <ToothPanel
                key={`${selectedTooth.fdi}-${asOf ?? 'now'}-${draft?.fdi === selectedTooth.fdi ? draft.key : ''}`}
                patientId={patientId}
                tooth={selectedTooth}
                toothLabel={toothLabel}
                sameJaw={chartOrder}
                treatments={treatments}
                quickPicks={quickPicks}
                visits={visits}
                defaultVisitId={defaultVisitId}
                today={today}
                canWrite={canWrite && !replaying}
                files={{ canRead: files.canRead, canUpload: files.canUpload && !replaying }}
                onChanged={() => {
                  setDraft(null)
                  router.refresh()
                }}
                labOrders={labOrders.filter((order) => order.teeth.includes(selectedTooth.fdi))}
                draft={draft?.fdi === selectedTooth.fdi && !replaying ? draft : null}
              />
            ) : (
              <p className="text-muted-foreground text-sm">{t('panel.pick')}</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
