import type { ComponentType } from 'react';
import { ClassicPage } from './classic/ClassicPage';
import { DistributedPage } from './distributed/DistributedPage';
import { ConcurrencyPage } from './cc/ConcurrencyPage';

/**
 * Every page of the app, in tab order. A page without a component is listed
 * as coming soon. `hash` is its route: '' for the root, so `#/` and no hash at
 * all both open Classic.
 */
export interface PageEntry {
  hash: string;
  title: string;
  blurb: string;
  component?: ComponentType;
  /** Older routes that still open this page, e.g. "mvcc". */
  aliases?: string[];
}

export const PAGES: PageEntry[] = [
  {
    hash: '',
    title: 'Classic',
    blurb: 'Serial, CSS, VSS, recoverable, ACA, strict',
    component: ClassicPage,
  },
  {
    hash: 'cc',
    title: 'Concurrency control',
    blurb: 'Locking (2PL, strict 2PL, deadlocks) and multiversion (MVSS, snapshot isolation)',
    component: ConcurrencyPage,
    aliases: ['mvcc'],
  },
  {
    hash: 'distributed',
    title: 'Multi-database',
    blurb: 'Local vs global serializability across databases',
    component: DistributedPage,
  },
];

/**
 * Whether pages that are not built yet appear as greyed-out "soon" tabs.
 * Off for now; turn on to show what is planned.
 */
export const SHOW_UPCOMING = false;

/** The pages that get a tab. */
export const TABS = PAGES.filter((p) => p.component || SHOW_UPCOMING);

/** The page for a location hash such as "#/mvcc"; unknown or unbuilt routes fall back to Classic. */
export function pageForHash(hash: string): PageEntry {
  const route = hash.replace(/^#\/?/, '');
  return (
    PAGES.find((p) => (p.hash === route || p.aliases?.includes(route)) && p.component) ?? PAGES[0]
  );
}
