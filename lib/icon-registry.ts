/**
 * Central icon registry for agent icons.
 * Stores icon names as strings (safe for JSON) and resolves them to LucideIcon components at runtime.
 * No hardcoded per-agent mappings — all icon choices live in ~/.dovepaw/agents.json.
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  BellRing,
  Bookmark,
  Bot,
  Brain,
  Bug,
  Calendar,
  Cat,
  Clock,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  Eye,
  File,
  FileText,
  Filter,
  Flag,
  FlaskConical,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  Hammer,
  Heart,
  Key,
  Layers,
  Leaf,
  LifeBuoy,
  Lock,
  Mail,
  Map,
  MessageCircle,
  Moon,
  Network,
  Package,
  Play,
  Radio,
  Radar,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserCheck,
  Users,
  Wand2,
  Wifi,
  Wrench,
  Zap,
} from "lucide-react";

/** All available icons, keyed by their string name (stored in agents.json). */
export const LUCIDE_ICON_REGISTRY: Record<string, LucideIcon> = {
  Activity,
  AlertCircle,
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  BellRing,
  Bookmark,
  Bot,
  Brain,
  Bug,
  Calendar,
  Cat,
  Clock,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  Eye,
  File,
  FileText,
  Filter,
  Flag,
  FlaskConical,
  Folder,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  Hammer,
  Heart,
  Key,
  Layers,
  Leaf,
  LifeBuoy,
  Lock,
  Mail,
  Map,
  MessageCircle,
  Moon,
  Network,
  Package,
  Play,
  Radar,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserCheck,
  Users,
  Wand2,
  Wifi,
  Wrench,
  Zap,
};

/** Sorted list of all available icon names (for the picker). */
export const ICON_NAMES: string[] = Object.keys(LUCIDE_ICON_REGISTRY).toSorted();

/** Resolve an icon name string → LucideIcon component, falling back to Bot. */
export function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Bot;
  return LUCIDE_ICON_REGISTRY[name] ?? Bot;
}

export interface IconColorPreset {
  label: string;
  /** Tailwind classes applied to the icon wrapper div */
  iconBg: string;
  /** Tailwind classes applied to the icon component */
  iconColor: string;
  /** CSS color for the swatch dot (avoids Tailwind purge) */
  swatch: string;
  /** CSS background color for the picker preview circle (avoids Tailwind purge) */
  previewBg: string;
  /** CSS icon color for the picker preview circle (avoids Tailwind purge) */
  previewIconColor: string;
}

/** Pre-defined color presets matching the suggestion card hover pattern. */
export const ICON_COLOR_PRESETS: IconColorPreset[] = [
  {
    label: "Default",
    iconBg: "bg-secondary group-hover:bg-primary",
    iconColor: "text-muted-foreground group-hover:text-primary-foreground",
    swatch: "#eaeff1",
    previewBg: "#eaeff1",
    previewIconColor: "#586064",
  },
  {
    label: "Yellow",
    iconBg: "bg-yellow-100 group-hover:bg-primary",
    iconColor: "text-yellow-700 group-hover:text-primary-foreground",
    swatch: "#FACC15",
    previewBg: "#FEF9C3",
    previewIconColor: "#A16207",
  },
  {
    label: "Blue",
    iconBg: "bg-blue-100 group-hover:bg-primary",
    iconColor: "text-blue-700 group-hover:text-primary-foreground",
    swatch: "#60A5FA",
    previewBg: "#DBEAFE",
    previewIconColor: "#1D4ED8",
  },
  {
    label: "Purple",
    iconBg: "bg-purple-100 group-hover:bg-primary",
    iconColor: "text-purple-700 group-hover:text-primary-foreground",
    swatch: "#C084FC",
    previewBg: "#F3E8FF",
    previewIconColor: "#7E22CE",
  },
  {
    label: "Red",
    iconBg: "bg-red-100 group-hover:bg-primary",
    iconColor: "text-red-600 group-hover:text-primary-foreground",
    swatch: "#F87171",
    previewBg: "#FEE2E2",
    previewIconColor: "#DC2626",
  },
  {
    label: "Green",
    iconBg: "bg-green-100 group-hover:bg-primary",
    iconColor: "text-green-700 group-hover:text-primary-foreground",
    swatch: "#4ADE80",
    previewBg: "#DCFCE7",
    previewIconColor: "#15803D",
  },
  {
    label: "Orange",
    iconBg: "bg-orange-100 group-hover:bg-primary",
    iconColor: "text-orange-700 group-hover:text-primary-foreground",
    swatch: "#FB923C",
    previewBg: "#FFEDD5",
    previewIconColor: "#C2410C",
  },
  {
    label: "Pink",
    iconBg: "bg-pink-100 group-hover:bg-primary",
    iconColor: "text-pink-700 group-hover:text-primary-foreground",
    swatch: "#F472B6",
    previewBg: "#FCE7F3",
    previewIconColor: "#BE185D",
  },
  {
    label: "Teal",
    iconBg: "bg-teal-100 group-hover:bg-primary",
    iconColor: "text-teal-700 group-hover:text-primary-foreground",
    swatch: "#2DD4BF",
    previewBg: "#CCFBF1",
    previewIconColor: "#0F766E",
  },
  {
    label: "Indigo",
    iconBg: "bg-indigo-100 group-hover:bg-primary",
    iconColor: "text-indigo-700 group-hover:text-primary-foreground",
    swatch: "#818CF8",
    previewBg: "#E0E7FF",
    previewIconColor: "#4338CA",
  },
];

export const DEFAULT_ICON_STYLE: Pick<IconColorPreset, "iconBg" | "iconColor"> =
  ICON_COLOR_PRESETS[0];
