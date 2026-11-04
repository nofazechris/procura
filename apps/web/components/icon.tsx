import {
  AlertTriangle, ArrowRight, Bell, Building2, ChartLine, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, CreditCard,
  ExternalLink, Fingerprint, FileText, Inbox, KeyRound, Leaf, LayoutGrid, Lock, LogOut, Mail, Menu, MessageSquare, MoreHorizontal,
  Moon, Package, Pause, Play, Plug, Plus, Scale, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Sun,
  TrendingUp, Users, UserPlus, Wallet, X, Zap, type LucideIcon,
} from "lucide-react";

const ICONS = {
  leaf: Leaf, arr: ArrowRight, search: Search, scale: Scale, card: CreditCard, shield: ShieldCheck, bolt: Zap, lock: Lock,
  chart: ChartLine, clock: Clock, wallet: Wallet, key: KeyRound, moon: Moon, sun: Sun, chev: ChevronDown, dots: MoreHorizontal,
  menu: Menu, bell: Bell, plus: Plus, check: Check, finger: Fingerprint, pkg: Package, users: Users, doc: FileText, msg: MessageSquare,
  grid: LayoutGrid, cog: Settings, sliders: SlidersHorizontal, plug: Plug, trend: TrendingUp, ext: ExternalLink, pause: Pause,
  play: Play, prev: ChevronLeft, next: ChevronRight, x: X, spark: Sparkles, send: Send, alert: AlertTriangle, copy: Copy,
  logout: LogOut, building: Building2, invite: UserPlus, mail: Mail, inbox: Inbox,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS | "agent";

/**
 * Procura's agent: a core with two orbits and a satellite. Used wherever the AI is meant, so it never
 * reads as the generic "sparkles" mark.
 */
function AgentMark({ strokeWidth, className }: { strokeWidth: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...(className ? { className } : {})}>
      <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-35 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(35 12 12)" opacity=".45" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="19.8" cy="6.55" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Sizing comes from the surrounding CSS (e.g. `.btn svg`), as in the prototype. */
export function Icon({ name, strokeWidth, className }: { name: IconName; strokeWidth?: number; className?: string }) {
  if (name === "agent") return <AgentMark strokeWidth={strokeWidth ?? 2} {...(className ? { className } : {})} />;
  const Cmp = ICONS[name];
  return <Cmp aria-hidden="true" strokeWidth={strokeWidth ?? 2} {...(className ? { className } : {})} />;
}
