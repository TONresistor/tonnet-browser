/**
 * Constantes pour les composants Settings
 */

import { AtSign, Globe, HardDrive, Wrench, Info, Cable } from 'lucide-react'
import type { SectionInfo } from './types'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'

// SVG icon component using asset (no JSX in .ts, use createElement)
import { createElement } from 'react'
function ThemedIcon(name: AppIconName) {
  return function Icon({ className }: { className?: string }) {
    return createElement(AppIcon, { name, className })
  }
}
const WalletIcon = ThemedIcon('wallet')
const CocoonIcon = ThemedIcon('cocoon')
const PrivacyIcon = ThemedIcon('privacy')
const NetworkIcon = ThemedIcon('network')
const AppearanceIcon = ThemedIcon('appearance')

/**
 * Liste des sections disponibles avec leurs métadonnées
 */
export const SECTIONS: SectionInfo[] = [
  // Group 0 — Preferences
  {
    id: 'general',
    label: 'General',
    icon: Globe,
    tileClass: 'bg-settings-blue text-identity-foreground',
    group: 0,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: AppearanceIcon,
    tileClass: 'bg-settings-purple text-identity-foreground',
    group: 0,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: PrivacyIcon,
    tileClass: 'bg-settings-green text-identity-foreground',
    group: 0,
  },
  {
    id: 'network',
    label: 'Network',
    icon: NetworkIcon,
    tileClass: 'bg-settings-cyan text-identity-foreground',
    group: 0,
  },
  {
    id: 'nameServices',
    label: 'Name Services',
    icon: AtSign,
    tileClass: 'bg-settings-indigo text-identity-foreground',
    group: 0,
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: HardDrive,
    tileClass: 'bg-settings-teal text-identity-foreground',
    group: 0,
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: WalletIcon,
    tileClass: 'bg-tonsite text-identity-foreground',
    group: 1,
  },
  {
    id: 'bridge',
    label: 'Bridge',
    icon: Cable,
    tileClass: 'bg-settings-orange text-identity-foreground',
    group: 1,
  },
  {
    id: 'cocoon',
    label: 'Cocoon AI',
    icon: CocoonIcon,
    tileClass: 'bg-settings-purple text-identity-foreground',
    group: 1,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Wrench,
    tileClass: 'bg-settings-slate text-identity-foreground',
    group: 2,
  },
  // Group 3 — Info
  {
    id: 'about',
    label: 'About',
    icon: Info,
    tileClass: 'bg-settings-blue text-identity-foreground',
    group: 3,
  },
]
