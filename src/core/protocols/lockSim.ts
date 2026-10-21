/**
 * The schedule replayed through a strict 2PL lock manager. The schedule is
 * read as the order requests arrive: a transaction whose request is refused
 * waits, and its later operations queue behind it until it gets the lock.
 * Locks are released when a transaction commits or aborts. On a conflict:
 *
 *   detect      wait, and abort the youngest transaction on any cycle in
 *               the wait-for graph
 *   wait-die    an older requester waits; a younger one dies (aborts)
 *   wound-wait  an older requester wounds (aborts) the younger holder; a
 *               younger requester waits
 *
 * Timestamps are arrival order, as in the notes: the transaction that
 * appears first is oldest. Aborted transactions are not restarted.
 */
import { findCycle } from '../graph';
import type { Edge } from '../graph';
import { opText, txnName } from '../schedule';
import type { Op, Schedule } from '../schedule';

export type Policy = 'detect' | 'wait-die' | 'wound-wait';

export type EventKind = 'run' | 'grant' | 'wait' | 'queue' | 'deadlock' | 'abort' | 'commit' | 'skip' | 'stuck';

export interface SimEvent {
  /** The arriving operation this event happened in response to (index in the schedule). */
  step: number;
  kind: EventKind;
  txn: number;
  text: string;
  /** Operations to highlight. */
  ops: number[];
}

export interface Deadlock {
  step: number;
  edges: Edge[];
  nodes: number[];
  cycle: number[];
  victim: number;
}

export interface SimResult {
  events: SimEvent[];
  /** Operations in the order they actually ran. */
  executed: Op[];
  aborted: number[];
  deadlocks: Deadlock[];
  /** Transactions still waiting when the schedule ran out. */
  stuck: number[];
  ts: Map<number, number>;
}

const T = txnName;

interface Lock {
  shared: Set<number>;
  exclusive: number | null;
}

export function simulate(s: Schedule, policy: Policy): SimResult {
  const ts = new Map<number, number>(s.txns.map((t, i) => [t, i + 1]));
  const locks = new Map<string, Lock>();
  const lockOf = (obj: string) => {
    let l = locks.get(obj);
    if (!l) {
      l = { shared: new Set(), exclusive: null };
      locks.set(obj, l);
    }
    return l;
  };
  const queued = new Map<number, Op[]>(); // a waiting transaction's pending operations, first is the blocked one
  const waitsFor = new Map<number, Set<number>>();
  const status = new Map<number, 'active' | 'aborted' | 'committed'>(s.txns.map((t) => [t, 'active']));
  const events: SimEvent[] = [];
  const executed: Op[] = [];
  const deadlocks: Deadlock[] = [];
  let step = 0;

  const log = (kind: EventKind, txn: number, text: string, ops: number[] = []) =>
    events.push({ step, kind, txn, text, ops });

  /** Who holds a lock on `obj` that `op`'s request conflicts with. */
  const blockers = (op: Op): number[] => {
    const l = lockOf(op.obj!);
    const out = new Set<number>();
    if (l.exclusive !== null && l.exclusive !== op.txn) out.add(l.exclusive);
    if (op.kind === 'W') for (const t of l.shared) if (t !== op.txn) out.add(t);
    return [...out];
  };

  const grant = (op: Op) => {
    const l = lockOf(op.obj!);
    if (op.kind === 'R') {
      if (l.exclusive === op.txn || l.shared.has(op.txn)) return;
      l.shared.add(op.txn);
      log('grant', op.txn, `${T(op.txn)} gets a shared lock on ${op.obj}.`, [op.index]);
    } else {
      if (l.exclusive === op.txn) return;
      const upgrade = l.shared.delete(op.txn);
      l.exclusive = op.txn;
      log('grant', op.txn, `${T(op.txn)} ${upgrade ? 'upgrades to' : 'gets'} an exclusive lock on ${op.obj}.`, [op.index]);
    }
  };

  const release = (t: number) => {
    for (const l of locks.values()) {
      l.shared.delete(t);
      if (l.exclusive === t) l.exclusive = null;
    }
    waitsFor.delete(t);
    for (const w of waitsFor.values()) w.delete(t);
  };

  const abort = (t: number, why: string) => {
    status.set(t, 'aborted');
    const dropped = queued.get(t) ?? [];
    queued.delete(t);
    release(t);
    log('abort', t, `${T(t)} aborts: ${why}${dropped.length > 0 ? ` Its queued ${dropped.map(opText).join(', ')} never run.` : ''}`, dropped.map((o) => o.index));
  };

  /** Tries to run `op` now; returns false when its transaction has to wait. */
  const attempt = (op: Op): boolean => {
    const t = op.txn;
    if (op.kind === 'C' || op.kind === 'A') {
      status.set(t, op.kind === 'C' ? 'committed' : 'aborted');
      release(t);
      executed.push(op);
      log(op.kind === 'C' ? 'commit' : 'abort', t, `${opText(op)}: ${T(t)} ${op.kind === 'C' ? 'commits' : 'aborts'} and releases its locks.`, [op.index]);
      return true;
    }
    let holders = blockers(op);
    if (holders.length > 0 && policy === 'wound-wait') {
      for (const h of holders.filter((h) => ts.get(h)! > ts.get(t)!)) {
        abort(h, `wounded by the older ${T(t)} (ts ${ts.get(t)} < ${ts.get(h)}), which wants ${op.obj}.`);
      }
      holders = blockers(op);
    }
    if (holders.length > 0 && policy === 'wait-die' && holders.some((h) => ts.get(h)! < ts.get(t)!)) {
      const older = holders.filter((h) => ts.get(h)! < ts.get(t)!);
      abort(
        t,
        `${opText(op)} needs ${op.obj}, held by the older ${older.map(T).join(', ')}; ${T(t)} is younger ` +
          `(ts ${ts.get(t)}), so under wait-die it dies instead of waiting.`,
      );
      return true;
    }
    if (holders.length > 0) {
      const before = waitsFor.get(t);
      const same = before !== undefined && before.size === holders.length && holders.every((h) => before.has(h));
      if (!same) {
        // Logged only when the wait starts or its reason changes, not on every retry.
        waitsFor.set(t, new Set(holders));
        log('wait', t, `${opText(op)} must wait: ${holders.map(T).join(', ')} ${holders.length === 1 ? 'holds' : 'hold'} a conflicting lock on ${op.obj}.`, [op.index]);
        if (policy === 'detect') detect();
      }
      return status.get(t) === 'aborted';
    }
    waitsFor.delete(t);
    grant(op);
    executed.push(op);
    log('run', t, `${opText(op)} runs.`, [op.index]);
    return true;
  };

  const detect = () => {
    const nodes = [...status.keys()].filter((t) => status.get(t) === 'active');
    const edges: Edge[] = [];
    for (const [a, bs] of waitsFor) {
      for (const b of bs) {
        edges.push({ from: a, to: b, rule: 'wr', ops: [], reasons: [`${T(a)} waits for ${T(b)} to release a lock`] });
      }
    }
    const cycle = findCycle({ nodes, edges });
    if (!cycle) return;
    const victim = cycle.slice(0, -1).reduce((v, t) => (ts.get(t)! > ts.get(v)! ? t : v));
    deadlocks.push({ step, edges, nodes, cycle, victim });
    log('deadlock', victim, `Deadlock: the wait-for graph has the cycle ${cycle.map(T).join(' → ')}.`);
    abort(victim, `chosen as the victim, the youngest on the cycle (ts ${ts.get(victim)}).`);
  };

  /** Runs a waiting transaction's queue for as long as its requests are granted. */
  const drain = (t: number) => {
    const q = queued.get(t);
    while (q && q.length > 0 && status.get(t) === 'active') {
      if (!attempt(q[0])) return;
      q.shift();
    }
    if (q && q.length === 0) queued.delete(t);
  };

  /** After locks are released, let waiting transactions retry, oldest first. */
  const wake = () => {
    let progress = true;
    while (progress) {
      progress = false;
      for (const t of [...queued.keys()].sort((a, b) => ts.get(a)! - ts.get(b)!)) {
        if (status.get(t) !== 'active') continue;
        const before = queued.get(t)!.length;
        drain(t);
        if ((queued.get(t)?.length ?? 0) !== before) progress = true;
      }
    }
  };

  for (const op of s.ops) {
    step = op.index;
    const t = op.txn;
    if (status.get(t) === 'aborted') {
      log('skip', t, `${opText(op)} is ignored: ${T(t)} has already aborted.`, [op.index]);
      continue;
    }
    const q = queued.get(t);
    if (q) {
      q.push(op);
      log('queue', t, `${opText(op)} queues: ${T(t)} is still waiting.`, [op.index]);
      continue;
    }
    if (!attempt(op)) queued.set(t, [op]);
    wake();
  }

  step = s.ops.length;
  const stuck = [...queued.keys()].filter((t) => status.get(t) === 'active');
  for (const t of stuck) {
    log('stuck', t, `${T(t)} is still waiting when the schedule ends, with ${queued.get(t)!.map(opText).join(', ')} not run.`, queued.get(t)!.map((o) => o.index));
  }

  return {
    events,
    executed,
    aborted: [...status.keys()].filter((t) => status.get(t) === 'aborted' && !s.ops.some((o) => o.txn === t && o.kind === 'A')),
    deadlocks,
    stuck,
    ts,
  };
}
