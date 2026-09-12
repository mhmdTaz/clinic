import {
  Building2,
  CalendarClock,
  CalendarDays,
  ChartLine,
  CircleDot,
  ClipboardList,
  Contact,
  FolderOpen,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Pill,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Stethoscope,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Navigation stores icon NAMES (it is shared with mobile); this maps them for the web. */
const ICONS: Record<string, LucideIcon> = {
  building: Building2,
  'calendar-clock': CalendarClock,
  'calendar-days': CalendarDays,
  'chart-line': ChartLine,
  'clipboard-list': ClipboardList,
  contact: Contact,
  folder: FolderOpen,
  'heart-pulse': HeartPulse,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  'life-buoy': LifeBuoy,
  package: Package,
  pill: Pill,
  receipt: Receipt,
  'scroll-text': ScrollText,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  stethoscope: Stethoscope,
  tags: Tags,
  users: Users,
}

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? CircleDot
  return <Icon className={className} aria-hidden="true" />
}
