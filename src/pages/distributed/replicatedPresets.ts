/**
 * Replicated-data examples: one local schedule per site. `expect` lists what
 * each is meant to show; testing checks the names against the analysis.
 */

export interface RepPreset {
  id: string;
  name: string;
  schedules: string;
  expect: Partial<Record<'atomic' | 'localCss' | 'union' | 'rowa' | 'rdsg' | 'oneCopy' | 'mutual', boolean>>;
}

export const REP_PRESETS: RepPreset[] = [
  {
    id: 'diverge',
    name: 'Copies updated in opposite orders',
    schedules: 'S1: W1(X) W2(X) C1 C2\nS2: W2(X) W1(X) C1 C2',
    expect: { localCss: true, union: false, rowa: true, rdsg: false, oneCopy: false, mutual: false },
  },
  {
    id: 'rowa-ok',
    name: 'Read one, write all: one-copy serializable',
    schedules: 'S1: R1(X) W1(X) C1 W2(X) C2\nS2: W1(X) C1 W2(X) R3(X) C2 C3',
    expect: { localCss: true, union: true, rowa: true, rdsg: true, oneCopy: true, mutual: true },
  },
  {
    id: 'blind-overwrite',
    name: '1SR, but no acyclic RDSG (blind write hides the order)',
    schedules: 'S1: W1(X) W2(X) W3(X) C1 C2 C3\nS2: W2(X) W1(X) W3(X) C1 C2 C3',
    expect: { localCss: true, union: false, rowa: true, mutual: true, rdsg: false, oneCopy: true },
  },
  {
    id: 'missed-copy',
    name: 'Writes skip copies: union acyclic, still not 1SR',
    schedules: 'S1: W1(X) R1(Y) C1\nS2: R2(X) W2(Y) C2',
    expect: { localCss: true, union: true, rowa: false, rdsg: false, oneCopy: false, mutual: false },
  },
  {
    id: 'stale-read',
    name: 'Reads a copy before the update reaches it, still 1SR',
    schedules: 'S1: W1(X) C1 R2(X) W2(Y) C2\nS2: R3(Y) R3(X) W1(X) C1 W2(Y) C3 C2',
    expect: { rowa: true, rdsg: true, oneCopy: true },
  },
  {
    id: 'partitioned',
    name: 'No replication: each site serializable, globally not',
    schedules: 'S1: R1(A) W2(A) C1 C2\nS2: R2(B) W1(B) C1 C2',
    expect: { localCss: true, union: false, rdsg: false, oneCopy: false },
  },
  {
    id: 'not-atomic',
    name: 'Commits at one site, aborts at another',
    schedules: 'S1: W1(X) C1\nS2: W1(X) A1',
    expect: { atomic: false },
  },
];

export const REP_DEFAULT = REP_PRESETS[0];
