import {
  Building2,
  CalendarClock,
  CalendarDays,
  CircleDot,
  ClipboardList,
  Contact,
  FolderOpen,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Pill,
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
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  'clipboard-list': ClipboardList,
  contact: Contact,
  folder: FolderOpen,
  'heart-pulse': HeartPulse,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  pill: Pill,
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
