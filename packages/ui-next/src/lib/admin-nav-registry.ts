import type { ComponentType } from 'react';
import type { PrivBit } from '@/lib/perms';

export interface AdminNavItem {
  /** Unique key within a section. */
  key: string;
  /** Display label (Chinese). */
  label: string;
  /** href the link points to. */
  href: string;
  /** Optional icon component (lucide-react). */
  icon?: ComponentType<{ className?: string }>;
  /** Template names that activate this item (used to highlight current). */
  templateNames?: string[];
  /** Required priv bit (any-of). If omitted, item is shown to anyone who can see the section. */
  requiredPriv?: PrivBit;
  /** Optional badge text (e.g., "新", count). */
  badge?: string | number;
}

export interface AdminNavSection {
  /** Unique key (e.g., 'domain', 'system', 'userbind', 'vigil'). */
  key: string;
  /** Display label. */
  label: string;
  /** Lower numbers appear first. */
  order: number;
  /** Required priv to see this section at all. If omitted, anyone with any admin priv sees it. */
  requiredPriv?: PrivBit;
  items: AdminNavItem[];
}

const sections = new Map<string, AdminNavSection>();

/**
 * Register a section of admin navigation. Idempotent: re-registering the same key overwrites.
 * Called at module-load time from each admin page module.
 */
export function registerAdminNavSection(section: AdminNavSection): void {
  sections.set(section.key, section);
}

export function getAdminNavSections(): AdminNavSection[] {
  return Array.from(sections.values()).sort((a, b) => a.order - b.order);
}

/** For tests / hot-reload only. */
export function clearAdminNavRegistry(): void {
  sections.clear();
}
