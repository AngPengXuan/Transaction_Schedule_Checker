/**
 * Multi-database examples: which database holds which objects, and a global
 * schedule. `expect` lists what each is meant to show; testing checks the
 * names against the analysis.
 */

export interface DistPreset {
  id: string;
  name: string;
  sites: string;
  schedule: string;
  expect: Partial<Record<'localCss' | 'global' | 's2pl' | 'snapshots' | 'fcw', boolean>>;
}

export const DIST_PRESETS: DistPreset[] = [
  {
    id: 'local-not-global',
    name: 'Each database serializable, the whole schedule not',
    sites: 'DB1: A\nDB2: B',
    schedule: 'R1(A) W2(A) R2(B) W1(B) C1 C2',
    expect: { localCss: true, global: false, s2pl: false },
  },
  {
    id: 's2pl',
    name: 'Strict 2PL at every database: globally serializable',
    sites: 'DB1: A\nDB2: B',
    schedule: 'R1(A) R2(B) W1(A) W2(B) C2 R1(B) C1',
    expect: { localCss: true, global: true, s2pl: true },
  },
  {
    id: 'three-way',
    name: 'A cycle through three databases',
    sites: 'DB1: A\nDB2: B\nDB3: C',
    schedule: 'R1(A) W2(A) R2(B) W3(B) R3(C) W1(C) C1 C2 C3',
    expect: { localCss: true, global: false, s2pl: false },
  },
  {
    id: 'snapshot-skew',
    name: 'Per-database snapshots disagree',
    sites: 'DB1: A\nDB2: B',
    schedule: 'R2(B) W1(A) W1(B) C1 R2(A) C2',
    expect: { snapshots: false },
  },
  {
    id: 'one-db',
    name: 'One database: the classic case',
    sites: 'DB1: A, B',
    schedule: 'R1(A) W2(A) R2(B) W1(B) C1 C2',
    expect: { localCss: false, global: false, snapshots: true },
  },
];

export const DIST_DEFAULT = DIST_PRESETS[0];
