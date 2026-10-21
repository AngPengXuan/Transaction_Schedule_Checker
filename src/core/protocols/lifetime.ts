import type { Op, Schedule } from '../schedule';

/** When a transaction runs: its first operation to its commit or abort. */
export interface Lifetime {
  start: number;
  /** Index of its C or A, or Infinity when it never finishes. */
  end: number;
  commit: number | null;
  abort: number | null;
}

/**
 * Every transaction's lifetime in `s`. `startOf` overrides when a transaction
 * is taken to begin -- the multi-database page starts it separately at each
 * database, at its first operation there.
 */
export function lifetimes(s: Schedule, startOf?: (t: number) => number): Map<number, Lifetime> {
  const out = new Map<number, Lifetime>();
  for (const t of s.txns) {
    const mine = s.ops.filter((o) => o.txn === t);
    const commit = mine.find((o) => o.kind === 'C')?.index ?? null;
    const abort = mine.find((o) => o.kind === 'A')?.index ?? null;
    out.set(t, {
      start: startOf ? startOf(t) : mine[0].index,
      end: commit ?? abort ?? Infinity,
      commit,
      abort,
    });
  }
  return out;
}

/** Two transactions are concurrent when each starts before the other finishes. */
export function concurrent(a: Lifetime, b: Lifetime): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The last write of `obj` by `t` before position `before`, if any. */
export function lastWriteBefore(ops: Op[], t: number, obj: string, before: number): Op | undefined {
  let found: Op | undefined;
  for (const o of ops) {
    if (o.index >= before) break;
    if (o.kind === 'W' && o.txn === t && o.obj === obj) found = o;
  }
  return found;
}
