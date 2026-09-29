import type { DentalScope, DentalSymbol } from '@clinic/config'

/**
 * The treatments a clinic starts with (Phase 11). They are written into the clinic's own list the
 * first time its chart is opened, and from then on they are the clinic's to rename, reorder,
 * price and retire. The codes are stable so a quick-pick can be seeded against them.
 */
export interface DefaultTreatment {
  code: string
  name: string
  symbol: DentalSymbol
  scope: DentalScope
}

export const DEFAULT_TREATMENTS: readonly DefaultTreatment[] = [
  { code: 'CARIES', name: 'Caries', symbol: 'CARIES', scope: 'SURFACE' },
  { code: 'FRACTURE', name: 'Fracture', symbol: 'FRACTURE', scope: 'TOOTH' },
  { code: 'IMPACTED', name: 'Impacted tooth', symbol: 'IMPACTED', scope: 'TOOTH' },
  { code: 'MISSING', name: 'Missing tooth', symbol: 'MISSING', scope: 'TOOTH' },
  { code: 'FILLING_COMPOSITE', name: 'Composite filling', symbol: 'FILLING', scope: 'SURFACE' },
  { code: 'FILLING_AMALGAM', name: 'Amalgam filling', symbol: 'FILLING', scope: 'SURFACE' },
  { code: 'SEALANT', name: 'Fissure sealant', symbol: 'SEALANT', scope: 'SURFACE' },
  { code: 'ROOT_CANAL', name: 'Root canal treatment', symbol: 'ROOT_CANAL', scope: 'TOOTH' },
  { code: 'CROWN_ZIRCONIA', name: 'Zirconia crown', symbol: 'CROWN', scope: 'TOOTH' },
  { code: 'CROWN_PFM', name: 'Porcelain-fused-to-metal crown', symbol: 'CROWN', scope: 'TOOTH' },
  { code: 'VENEER', name: 'Veneer', symbol: 'VENEER', scope: 'TOOTH' },
  { code: 'IMPLANT', name: 'Implant', symbol: 'IMPLANT', scope: 'TOOTH' },
  { code: 'EXTRACTION', name: 'Extraction', symbol: 'EXTRACTION', scope: 'TOOTH' },
  { code: 'BRIDGE', name: 'Bridge', symbol: 'BRIDGE', scope: 'SPAN' },
  { code: 'DENTURE_PARTIAL', name: 'Partial denture', symbol: 'DENTURE', scope: 'ARCH' },
  { code: 'DENTURE_COMPLETE', name: 'Complete denture', symbol: 'DENTURE', scope: 'ARCH' },
]
