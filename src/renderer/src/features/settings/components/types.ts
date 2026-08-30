/**
 * Types partagés pour les composants Settings
 */

import type { AppPreferences } from '@/features/settings/preferences-store'

/**
 * Sections disponibles dans les paramètres
 */
export type SettingsSection =
  | 'general'
  | 'network'
  | 'nameServices'
  | 'storage'
  | 'appearance'
  | 'privacy'
  | 'advanced'
  | 'wallet'
  | 'bridge'
  | 'cocoon'
  | 'about'

/**
 * Props communes à toutes les sections
 */
export interface SectionProps {
  draft: AppPreferences
  setDraft: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
}

/**
 * Information sur une section (pour la navigation)
 */
export interface SectionInfo {
  id: SettingsSection
  label: string
  icon: React.ElementType
  tileClass: string
  /** Index of the grouped inset block this section belongs to */
  group: number
}
