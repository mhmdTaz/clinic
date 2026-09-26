import {
  ArrowDownRight,
  Circle,
  CircleDashed,
  Crown,
  Link,
  Pin,
  ShieldCheck,
  Smile,
  Sparkles,
  Square,
  Syringe,
  TriangleAlert,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { DentalSymbol } from '@clinic/contracts'

/** The small picture a treatment carries on a badge, a button and a timeline row. */
export const SYMBOL_ICONS: Record<DentalSymbol, LucideIcon> = {
  CROWN: Crown,
  ROOT_CANAL: Syringe,
  FILLING: Square,
  IMPLANT: Pin,
  EXTRACTION: X,
  MISSING: CircleDashed,
  BRIDGE: Link,
  DENTURE: Smile,
  VENEER: Sparkles,
  SEALANT: ShieldCheck,
  CARIES: TriangleAlert,
  FRACTURE: Zap,
  IMPACTED: ArrowDownRight,
  OTHER: Circle,
}

export function SymbolIcon({
  symbol,
  className,
  size = 16,
}: {
  symbol: DentalSymbol
  className?: string
  size?: number
}) {
  const Icon = SYMBOL_ICONS[symbol]
  return <Icon aria-hidden="true" className={className} size={size} />
}
