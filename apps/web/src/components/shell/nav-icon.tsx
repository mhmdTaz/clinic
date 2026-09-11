import {
  Building2,
  CircleDot,
  ClipboardList,
  Contact,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldCheck,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Navigation stores icon NAMES (it is shared with mobile); this maps them for the web. */
const ICONS: Record<string, LucideIcon> = {
  building: Building2,
  'clipboard-list': ClipboardList,
  contact: Contact,
  'heart-pulse': HeartPulse,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  stethoscope: Stethoscope,
  users: Users,
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? CircleDot
  return <Icon className={className} aria-hidden="true" />
}
