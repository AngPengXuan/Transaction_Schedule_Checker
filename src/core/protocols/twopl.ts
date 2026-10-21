/**
 * Could two-phase locking have produced this schedule? As in the CS3223
 * notes: a shared lock before a read, an exclusive lock before a write
 * (upgrading S to X is allowed in the growing phase), incompatible locks
 * never held together, and no lock acquired after the first unlock.
 *
 * Each transaction has a lock point: every acquisition happens before it,
 * every release after it. So each of its locks is held over an interval
 * that contains the lock point and all its uses of the object. Given the
 * lock points, the shortest such intervals -- acquire as late as possible,
 * release as early as possible -- are the least likely to clash, so the
 * schedule is 2PL exactly when some choice of lock points makes those
 * shortest intervals compatible. The search tries every choice, pruned by
 * the window each lock point must fall in.
 */
import { opText, txnName } from '../schedule';
import type { Op, Schedule } from '../schedule';
import type { Verdict } from '../verdict';
import { lifetimes } from './lifetime';

const T = txnName;

/** One transaction's use of one object. */
interface Use {
  txn: number;
  obj: string;
  first: number;
  last: number;
  /** First write, or null when the transaction only reads the object. */
  firstWrite: number | null;
}

export type LockActionKind = 'lock-S' | 'lock-X' | 'upgrade' | 'unlock' | 'lock-point';

/** A lock action placed in the schedule. `at` is a position between or around operations. */
export interface LockAction {
  at: number;
  txn: number;
  obj: string | null;
  kind: LockActionKind;
}

export interface TwoPlResult extends Verdict {
  /** One valid placement of lock actions, when the schedule is 2PL. */
  plan: LockAction[] | null;
  lockPoints: Map<number, number> | null;
}

const MAX_TXNS = 6;

function usesOf(ops: Op[]): Use[] {
  const out: Use[] = [];
  for (const o of ops) {
    if (o.kind !== 'R' && o.kind !== 'W') continue;
    let u = out.find((x) => x.txn === o.txn && x.obj === o.obj);
    if (!u) {
      u = { txn: o.txn, obj: o.obj!, first: o.index, last: o.index, firstWrite: null };
      out.push(u);
    }
    u.last = o.index;
    if (o.kind === 'W' && u.firstWrite === null) u.firstWrite = o.index;
  }
  return out;
}

/** The shortest S and X intervals for `u`, given its transaction's lock point. */
function intervals(u: Use, lp: number) {
  const end = Math.max(u.last, lp);
  return {
    s: [Math.min(u.first, lp), end] as const,
    x: u.firstWrite === null ? null : ([Math.min(u.firstWrite, lp), end] as const),
  };
}

function overlap(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

function clash(u: Use, lpU: number, v: Use, lpV: number): boolean {
  const a = intervals(u, lpU);
  const b = intervals(v, lpV);
  return (a.x !== null && overlap(a.x, b.s)) || (b.x !== null && overlap(b.x, a.s));
}

/** Conflicting operation pairs: same object, different transactions, at least one write. */
function conflicts(ops: Op[]): [Op, Op][] {
  const out: [Op, Op][] = [];
  const data = ops.filter((o) => o.kind === 'R' || o.kind === 'W');
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i];
      const b = data[j];
      if (a.txn !== b.txn && a.obj === b.obj && (a.kind === 'W' || b.kind === 'W')) out.push([a, b]);
    }
  }
  return out;
}

export function check2pl(s: Schedule): TwoPlResult {
  const uses = usesOf(s.ops);
  const life = lifetimes(s);
  const txns = s.txns.filter((t) => uses.some((u) => u.txn === t));
  const pairs = conflicts(s.ops);

  // Each lock point's window: after every conflicting operation it must wait
  // for (it acquires that lock only after the other releases it), before every
  // conflicting operation that waits for it (it releases that lock first), and
  // before the transaction ends.
  const window = new Map<number, { after: Op | null; before: Op | null }>();
  for (const t of txns) {
    let after: Op | null = null;
    let before: Op | null = null;
    for (const [a, b] of pairs) {
      if (b.txn === t && (!after || a.index > after.index)) after = a;
      if (a.txn === t && (!before || b.index < before.index)) before = b;
    }
    window.set(t, { after, before });
  }
  const candidates = new Map<number, number[]>();
  for (const t of txns) {
    const { after, before } = window.get(t)!;
    const lo = after ? after.index : -1;
    const hi = Math.min(before ? before.index : Infinity, life.get(t)!.end);
    const c: number[] = [];
    for (let p = lo; p < hi && p < s.ops.length; p++) c.push(p + 0.5);
    candidates.set(t, c);
  }

  const empty = txns.find((t) => candidates.get(t)!.length === 0);
  if (empty !== undefined) {
    const { after, before } = window.get(empty)!;
    const ends = life.get(empty)!.end;
    const limit =
      before && before.index < ends
        ? `before ${opText(before)} (step ${before.index + 1}), which needs a lock ${T(empty)} holds`
        : `before it ends (step ${ends + 1})`;
    return {
      holds: false,
      summary: `${T(empty)} has nowhere to put its lock point.`,
      violations: [
        {
          text:
            `${T(empty)} must reach its lock point after ${opText(after!)} (step ${after!.index + 1}), ` +
            `whose lock it has to wait for, but also ${limit}. No moment is both.`,
          ops: [after!.index, ...(before ? [before.index] : [])],
        },
      ],
      plan: null,
      lockPoints: null,
    };
  }
  if (txns.length > MAX_TXNS) {
    return {
      holds: false,
      summary: `Too many transactions to search (more than ${MAX_TXNS}).`,
      violations: [],
      plan: null,
      lockPoints: null,
    };
  }

  const chosen = new Map<number, number>();
  const search = (k: number): boolean => {
    if (k === txns.length) return true;
    const t = txns[k];
    const mine = uses.filter((u) => u.txn === t);
    for (const lp of candidates.get(t)!) {
      const ok = mine.every((u) =>
        uses.every((v) => v.txn === t || v.obj !== u.obj || !chosen.has(v.txn) || !clash(u, lp, v, chosen.get(v.txn)!)),
      );
      if (!ok) continue;
      chosen.set(t, lp);
      if (search(k + 1)) return true;
      chosen.delete(t);
    }
    return false;
  };

  if (!search(0)) {
    return {
      holds: false,
      summary: 'No placement of lock points works for every transaction at once.',
      violations: txns.map((t) => {
        const { after, before } = window.get(t)!;
        return {
          text:
            `${T(t)}'s lock point would have to fall ` +
            (after ? `after ${opText(after)} (step ${after.index + 1})` : 'anywhere up to') +
            (before ? ` and before ${opText(before)} (step ${before.index + 1})` : '') +
            ', but every such choice leaves two incompatible locks held at once.',
          ops: [...(after ? [after.index] : []), ...(before ? [before.index] : [])],
        };
      }),
      plan: null,
      lockPoints: null,
    };
  }

  return {
    holds: true,
    summary: 'Yes: one placement of lock and unlock actions is shown below.',
    violations: [],
    plan: planFor(uses, chosen),
    lockPoints: chosen,
  };
}

/**
 * The lock actions for the chosen lock points. Acquisitions sit just before
 * the operation that needs them (or at the lock point, if that is earlier);
 * releases just after the last use (or at the lock point, if that is later).
 */
function planFor(uses: Use[], lps: Map<number, number>): LockAction[] {
  const out: LockAction[] = [];
  for (const u of uses) {
    const lp = lps.get(u.txn)!;
    const take = (use: number) => (use < lp ? use - 0.3 : lp - 0.1);
    out.push({ at: take(u.first), txn: u.txn, obj: u.obj, kind: u.firstWrite === u.first ? 'lock-X' : 'lock-S' });
    if (u.firstWrite !== null && u.firstWrite !== u.first) {
      out.push({ at: take(u.firstWrite), txn: u.txn, obj: u.obj, kind: 'upgrade' });
    }
    out.push({ at: u.last > lp ? u.last + 0.3 : lp + 0.1, txn: u.txn, obj: u.obj, kind: 'unlock' });
  }
  for (const [t, lp] of lps) out.push({ at: lp, txn: t, obj: null, kind: 'lock-point' });
  return out.sort((a, b) => a.at - b.at || a.txn - b.txn);
}

export function lockActionText(a: LockAction): string {
  switch (a.kind) {
    case 'lock-S':
      return `l-S${a.txn}(${a.obj})`;
    case 'lock-X':
      return `l-X${a.txn}(${a.obj})`;
    case 'upgrade':
      return `l-X${a.txn}(${a.obj}) upgrade`;
    case 'unlock':
      return `u${a.txn}(${a.obj})`;
    case 'lock-point':
      return 'lock point';
  }
}

