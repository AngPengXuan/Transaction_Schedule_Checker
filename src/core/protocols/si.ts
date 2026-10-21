/**
 * Snapshot isolation, checked against a given schedule: does every read see
 * the version SI would give it, and does first-committer-wins hold? A
 * transaction's snapshot is everything committed before it starts; it always
 * sees its own writes.
 */
import { opText, T0, txnName } from '../schedule';
import type { Op, Schedule } from '../schedule';
import type { Verdict, Violation } from '../verdict';
import { concurrent, lastWriteBefore, lifetimes } from './lifetime';
import type { Lifetime } from './lifetime';

const T = txnName;

/**
 * The version a read sees as written: the version it names, or for a plain
 * read the latest earlier write that has not been rolled back by then.
 */
export function seenVersion(s: Schedule, read: Op): number {
  if (read.version !== undefined) return read.version;
  for (let j = read.index - 1; j >= 0; j--) {
    const w = s.ops[j];
    if (w.kind !== 'W' || w.obj !== read.obj) continue;
    const aborted = s.ops.find((o) => o.txn === w.txn && o.kind === 'A');
    if (aborted && aborted.index < read.index) continue;
    return w.txn;
  }
  return T0;
}

/**
 * The version SI gives `read`, for a transaction whose snapshot was taken at
 * position `start`: its own earlier write if it has one, otherwise the
 * version of whichever transaction committed last before `start`.
 */
export function snapshotVersion(
  s: Schedule,
  read: Op,
  start: number,
  life: Map<number, Lifetime>,
): number {
  if (lastWriteBefore(s.ops, read.txn, read.obj!, read.index)) return read.txn;
  let best = T0;
  let bestCommit = -1;
  for (const [t, l] of life) {
    if (t === read.txn || l.commit === null || l.commit >= start) continue;
    if (!lastWriteBefore(s.ops, t, read.obj!, l.commit)) continue;
    if (l.commit > bestCommit) {
      best = t;
      bestCommit = l.commit;
    }
  }
  return best;
}

export interface SnapshotRead {
  read: Op;
  start: number;
  seen: number;
  snapshot: number;
}

/** What each read sees, next to what its snapshot would give it. */
export function snapshotReads(s: Schedule, startOf?: (t: number) => number): SnapshotRead[] {
  const life = lifetimes(s, startOf);
  return s.ops
    .filter((o) => o.kind === 'R')
    .map((read) => {
      const start = startOf ? startOf(read.txn) : life.get(read.txn)!.start;
      return { read, start, seen: seenVersion(s, read), snapshot: snapshotVersion(s, read, start, life) };
    });
}

function versionName(t: number, obj: string): string {
  return t === T0 ? `the initial ${obj}` : `${T(t)}'s ${obj}`;
}

export function checkSnapshotReads(s: Schedule, startOf?: (t: number) => number): Verdict {
  const violations: Violation[] = [];
  for (const r of snapshotReads(s, startOf)) {
    if (r.seen === r.snapshot) continue;
    const obj = r.read.obj!;
    violations.push({
      text:
        `${opText(r.read)} sees ${versionName(r.seen, obj)}, but ${T(r.read.txn)}'s snapshot ` +
        `(taken at step ${r.start + 1}) holds ${versionName(r.snapshot, obj)}.`,
      ops: [r.read.index, r.start],
    });
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every read sees its own write or the latest version committed before its transaction started.'
        : 'Some read sees a version its snapshot would not contain.',
    violations,
  };
}

/**
 * First-committer-wins: of two concurrent transactions that write the same
 * object, only the first to commit may; the second must abort. A transaction
 * with no commit or abort counts as committing after the schedule ends, in
 * order of appearance -- as the committed projection treats it.
 */
export function checkFirstCommitterWins(s: Schedule): Verdict {
  const life = lifetimes(s);
  const commitAt = (t: number) => life.get(t)!.commit ?? s.ops.length + s.txns.indexOf(t);
  const when = (t: number) =>
    life.get(t)!.commit === null ? 'after the schedule ends' : `at step ${life.get(t)!.commit! + 1}`;
  const committed = s.txns
    .filter((t) => s.status[t] !== 'aborted')
    .sort((a, b) => commitAt(a) - commitAt(b));
  const violations: Violation[] = [];
  for (let i = 0; i < committed.length; i++) {
    for (let j = i + 1; j < committed.length; j++) {
      const a = committed[i];
      const b = committed[j];
      if (!concurrent(life.get(a)!, life.get(b)!)) continue;
      const shared = s.objects.filter(
        (obj) =>
          s.ops.some((o) => o.kind === 'W' && o.txn === a && o.obj === obj) &&
          s.ops.some((o) => o.kind === 'W' && o.txn === b && o.obj === obj),
      );
      if (shared.length === 0) continue;
      violations.push({
        text:
          `${T(a)} and ${T(b)} run concurrently and both write ${shared.join(', ')}. ${T(a)} ` +
          `commits first (${when(a)}), so ${T(b)} must abort instead of committing ${when(b)}.`,
        ops: [
          ...s.ops
            .filter((o) => o.kind === 'W' && (o.txn === a || o.txn === b) && shared.includes(o.obj!))
            .map((o) => o.index),
          ...[life.get(a)!.commit, life.get(b)!.commit].filter((c): c is number => c !== null),
        ],
      });
    }
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'No two concurrent committed transactions write the same object.'
        : 'Two concurrent transactions both commit writes to the same object.',
    violations,
  };
}
