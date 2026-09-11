import {
  Building2,
  CircleDot,
  ClipboardList,
  HeartPulse,
  LayoutDashboard,
  Shield,
  ShieldCheck,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react'

/** Navigation stores icon NAMES (it is shared with mobile); this maps them for the web. */
const ICONS: Record<string, LucideIcon> = {
  building: Building2,
  'clipboard-list': ClipboardList,
  'heart-pulse': HeartPulse,
  'layout-dashboard': LayoutDashboard,
  shield: Shield,
  'shield-check': ShieldCheck,
  stethoscope: Stethoscope,
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? CircleDot
  return <Icon className={className} aria-hidden="true" />
}
