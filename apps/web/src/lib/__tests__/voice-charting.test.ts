import { describe, expect, it } from 'vitest'
import { parseVoiceCharting, type VoiceTreatment } from '@/lib/dental/voice'

const T = (
  id: string,
  name: string,
  symbol: VoiceTreatment['symbol'],
  scope: VoiceTreatment['scope'] = 'TOOTH',
): VoiceTreatment => ({ id, code: id.toUpperCase(), name, symbol, scope, isActive: true })

const CATALOGUE: VoiceTreatment[] = [
  T('caries', 'Caries', 'CARIES', 'SURFACE'),
  T('composite', 'Composite filling', 'FILLING', 'SURFACE'),
  T('amalgam', 'Amalgam filling', 'FILLING', 'SURFACE'),
  T('rct', 'Root canal treatment', 'ROOT_CANAL'),
  T('zirconia', 'Zirconia crown', 'CROWN'),
  T('pfm', 'Porcelain-fused-to-metal crown', 'CROWN'),
  T('extraction', 'Extraction', 'EXTRACTION'),
  T('fracture', 'Fracture', 'FRACTURE'),
  { ...T('retired', 'Gold inlay', 'FILLING', 'SURFACE'), isActive: false },
]

const draft = (transcript: string) => {
  const parsed = parseVoiceCharting(transcript, CATALOGUE)
  if (!parsed.ok) throw new Error(`no draft: ${parsed.reason}`)
  return parsed.draft
}

describe('voice charting', () => {
  it('reads the sentence it was built for', () => {
    expect(draft('sixteen MOD composite done')).toMatchObject({
      fdi: '16',
      surfaces: ['M', 'O', 'D'],
      treatmentId: 'composite',
      status: 'COMPLETED',
      alternatives: [],
    })
  })

  it('takes a tooth however the speech service wrote it down', () => {
    expect(draft('16 composite MO').fdi).toBe('16')
    expect(draft('tooth one six extraction').fdi).toBe('16')
    expect(draft('twenty four composite M O').fdi).toBe('24')
    expect(draft('two six decay occlusal').fdi).toBe('26')
    expect(draft('fifty five caries').fdi).toBe('55')
  })

  it('does not read a number of weeks as a tooth', () => {
    expect(parseVoiceCharting('crown planned for six weeks', CATALOGUE)).toMatchObject({
      ok: false,
      reason: 'NO_TOOTH',
    })
  })

  it('names surfaces in letters next to the tooth, or in words anywhere', () => {
    expect(draft('36 M O D amalgam').surfaces).toEqual(['M', 'O', 'D'])
    expect(draft('decay on 26 distal and buccal').surfaces).toEqual(['D', 'B'])
    // A front tooth has an incisal edge, not an occlusal surface; a back tooth the other way.
    expect(draft('eleven MO composite').surfaces).toEqual(['M', 'I'])
    expect(draft('46 incisal composite').surfaces).toEqual(['O'])
  })

  it('gives no surfaces to work done on the whole tooth', () => {
    expect(draft('16 MOD root canal done')).toMatchObject({ treatmentId: 'rct', surfaces: [] })
  })

  it('knows a finding by its everyday name, and the status by what was said', () => {
    expect(draft('26 decay occlusal found')).toMatchObject({
      treatmentId: 'caries',
      status: 'CONDITION',
    })
    expect(draft('11 broken').treatmentId).toBe('fracture')
    expect(draft('48 extraction to do').status).toBe('PLANNED')
    expect(draft('36 crown existing').status).toBe('EXISTING')
    expect(draft('36 composite O').status).toBeNull()
  })

  it('offers both when two treatments fit equally, rather than guessing', () => {
    expect(draft('16 crown planned')).toMatchObject({
      treatmentId: 'zirconia',
      alternatives: ['Porcelain-fused-to-metal crown'],
    })
    expect(draft('16 zirconia crown')).toMatchObject({ treatmentId: 'zirconia', alternatives: [] })
  })

  it('makes no draft without a tooth or a treatment, and ignores retired treatments', () => {
    expect(parseVoiceCharting('composite done', CATALOGUE)).toMatchObject({
      ok: false,
      reason: 'NO_TOOTH',
    })
    expect(parseVoiceCharting('sixteen please', CATALOGUE)).toMatchObject({
      ok: false,
      reason: 'NO_TREATMENT',
    })
    expect(parseVoiceCharting('sixteen gold inlay', CATALOGUE)).toMatchObject({
      ok: false,
      reason: 'NO_TREATMENT',
    })
  })
})
