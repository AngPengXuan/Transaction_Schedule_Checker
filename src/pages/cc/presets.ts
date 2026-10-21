/**
 * Concurrency-control examples, in two groups. Each one's `expect` lists what
 * it is meant to show; the checks are run against these in testing, so a
 * name can't drift from what the schedule actually does.
 */

type Check =
  | 'mono' | 'vss' | 'mvss' | 'si' | 'fcw' | 'snapshot' | 'dsg' | 'ssi'
  | 'strict2pl' | 'twoPl' | 'css' | 'deadlock';

export interface MvPreset {
  id: string;
  name: string;
  schedule: string;
  expect: Partial<Record<Check, boolean>>;
}

export const LOCK_PRESETS: MvPreset[] = [
  {
    id: 'deadlock',
    name: 'Deadlock: each waits for the other (lecture example)',
    schedule: 'R1(A) R2(B) W1(B) W2(A) C1 C2',
    expect: { strict2pl: false, twoPl: false, css: false, deadlock: true },
  },
  {
    id: 'upgrade-deadlock',
    name: 'Upgrade deadlock: both read, then both write',
    schedule: 'R1(A) R2(A) W1(A) W2(A) C1 C2',
    expect: { strict2pl: false, twoPl: false, deadlock: true },
  },
  {
    id: '2pl-not-strict',
    name: '2PL, not strict 2PL: releases before commit',
    schedule: 'W1(A) R2(A) C1 C2',
    expect: { strict2pl: false, twoPl: true, css: true, deadlock: false },
  },
  {
    id: 'css-not-2pl',
    name: 'Conflict serializable, but no 2PL lock point works',
    schedule: 'R1(A) W2(A) R3(B) W1(B) C1 C2 C3',
    expect: { strict2pl: false, twoPl: false, css: true },
  },
  {
    id: 'strict',
    name: 'Strict 2PL: every lock held to commit',
    schedule: 'R1(A) R2(A) W1(B) C1 W2(B) C2',
    expect: { strict2pl: true, twoPl: true, css: true, deadlock: false },
  },
];

export const MV_PRESETS: MvPreset[] = [
  {
    id: 'mono-serial',
    name: 'Serial, one version at a time',
    schedule: 'W1(A) C1 R2,1(A) W2(A) C2',
    expect: { mono: true, vss: true, mvss: true, si: true, ssi: true },
  },
  {
    id: 'old-version',
    name: 'Reads an old version: MVSS, not VSS',
    schedule: 'R1,0(A) W2(A) W2(B) C2 R1,0(B) C1',
    expect: { mono: false, vss: false, mvss: true, si: true, dsg: true },
  },
  {
    id: 'lost-update',
    name: 'Lost update: first-committer-wins aborts T2',
    schedule: 'R1,0(A) R2,0(A) W1(A) W2(A) C1 C2',
    expect: { mvss: false, snapshot: true, fcw: false, si: false },
  },
  {
    id: 'write-skew',
    name: 'Write skew: SI allows it, not serializable',
    schedule: 'R1,0(A) R1,0(B) R2,0(A) R2,0(B) W1(A) W2(B) C1 C2',
    expect: { mvss: false, si: true, dsg: false, ssi: false },
  },
  {
    id: 'read-only',
    name: 'Read-only anomaly (three transactions, one pivot)',
    schedule: 'R2,0(X) R2,0(Y) R1,0(Y) W1(Y) C1 R3,0(X) R3,1(Y) C3 W2(X) C2',
    expect: { mvss: false, si: true, dsg: false, ssi: false },
  },
  {
    id: 'snapshot-violation',
    name: 'Sees a commit after its snapshot: not SI',
    schedule: 'R2,0(B) W1(A) C1 R2,1(A) C2',
    expect: { mvss: true, snapshot: false, si: false },
  },
  {
    id: 'unversioned',
    name: 'Plain reads (latest write): use "Fill SI versions"',
    schedule: 'R1(A) W1(A) R2(A) W2(A) C1 C2',
    expect: { mono: true, snapshot: false, fcw: false },
  },
  {
    id: 'dirty-version',
    name: 'Reads an uncommitted version, commits first: not recoverable',
    schedule: 'W1(A) R2,1(A) C2 C1',
    expect: { mvss: true, snapshot: false },
  },
];

export const CC_PRESETS = [...LOCK_PRESETS, ...MV_PRESETS];

export const CC_DEFAULT = LOCK_PRESETS[0];
