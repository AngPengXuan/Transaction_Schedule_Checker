/**
 * Strict two-phase locking, as in the CS3223 notes: a shared lock before each
 * read, an exclusive lock before each write, and every lock held until the
 * transaction commits or aborts. A schedule could have been produced under
 * S2PL exactly when no operation needs a lock another running transaction
 * still holds.
 */
import { opText, txnName } from '../schedule';
import type { Op, Schedule } from '../schedule';
import type { Verdict, Violation } from '../verdict';
import { lifetimes } from './lifetime';

const T = txnName;

/**
 * Checks `s`, or only the operations in `only` (one database's share of a
 * global schedule) -- commit and abort times always come from all of `s`.
 */
export function checkS2pl(s: Schedule, only?: Op[]): Verdict {
  const life = lifetimes(s);
  const ops = (only ?? s.ops).filter((o) => o.kind === 'R' || o.kind === 'W');
  const violations: Violation[] = [];
  for (let k = 0; k < ops.length; k++) {
    const b = ops[k];
    const blamed = new Set<number>();
    for (let i = 0; i < k; i++) {
      const a = ops[i];
      if (a.txn === b.txn || a.obj !== b.obj || blamed.has(a.txn)) continue;
      if (a.kind === 'R' && b.kind === 'R') continue;
      const end = life.get(a.txn)!.end;
      if (end < b.index) continue;
      blamed.add(a.txn);
      const lock = a.kind === 'W' ? 'an exclusive' : 'a shared';
      const need = b.kind === 'W' ? 'an exclusive' : 'a shared';
      violations.push({
        text:
          `${opText(b)} (step ${b.index + 1}) needs ${need} lock on ${b.obj}, but ${T(a.txn)} ` +
          `still holds ${lock} lock from ${opText(a)} (step ${a.index + 1}) ` +
          (end === Infinity
            ? 'and never releases it.'
            : `until it ${s.ops[end].kind === 'C' ? 'commits' : 'aborts'} at step ${end + 1}.`),
        ops: [a.index, b.index, ...(end === Infinity ? [] : [end])],
      });
    }
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every operation gets its lock: no conflicting lock is held by a running transaction.'
        : 'Some operation would have to wait for a lock held until another transaction ends.',
    violations,
  };
}
