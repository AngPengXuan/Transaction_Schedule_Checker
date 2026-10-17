/**
 * The classic page's checks: serial, CSS, VSS and the three recoverability
 * properties, on an ordinary (monoversion) schedule.
 */
import { cycleText, orderText } from '../../core/format';
import { addEdge, cycleArcs, findCycle, topoOrder } from '../../core/graph';
import type { Edge, Graph } from '../../core/graph';
import { latestWriteReadsFrom, viewGraph } from '../../core/polygraph';
import type { ViewResult } from '../../core/polygraph';
import { committedProjection, opText, txnName } from '../../core/schedule';
import type { Op, Schedule } from '../../core/schedule';
import type { Verdict, Violation } from '../../core/verdict';

const T = txnName;

// ================================================================ serial

/** Serial: each transaction runs start to finish, commit or abort included, with nothing in between. */
export function checkSerial(s: Schedule): Verdict {
  const last = new Map<number, number>();
  for (const op of s.ops) last.set(op.txn, op.index);

  let current: number | null = null;
  for (const op of s.ops) {
    if (current !== null && op.txn !== current && last.get(current)! > op.index) {
      const end = s.ops[last.get(current)!];
      return {
        holds: false,
        summary: `${opText(op)} runs while ${T(current)} is still going.`,
        violations: [
          {
            text:
              `${opText(op)} (step ${op.index + 1}) interleaves with ${T(current)}, which has ` +
              `not finished — its last operation is ${opText(end)} at step ${end.index + 1}.`,
            ops: [op.index, end.index],
          },
        ],
      };
    }
    current = op.txn;
  }
  const order = [...new Set(s.ops.map((op) => op.txn))];
  return {
    holds: true,
    summary: `Transactions run back to back: ${orderText(order)}.`,
    violations: [],
  };
}

// =================================================== conflict serializable

export interface CssResult extends Verdict {
  graph: Graph;
  cycle: number[] | null;
  order: number[] | null;
}

const CONFLICT_RULE = { RW: 'rw', WR: 'wr', WW: 'ww' } as const;

/**
 * Precedence graph over the committed projection: an edge Ti → Tj for every
 * pair of conflicting operations (same object, different transactions, at
 * least one write) where Ti's comes first.
 */
export function checkCss(s: Schedule): CssResult {
  const { ops, txns } = committedProjection(s);
  const edges: Edge[] = [];
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];
      if (a.txn === b.txn || a.obj !== b.obj) continue;
      if (a.kind === 'R' && b.kind === 'R') continue;
      const rule = CONFLICT_RULE[`${a.kind}${b.kind}` as keyof typeof CONFLICT_RULE];
      addEdge(edges, {
        from: a.txn,
        to: b.txn,
        rule,
        ops: [a.index, b.index],
        reasons: [`${opText(a)} before ${opText(b)}`],
      });
    }
  }
  const graph = { nodes: txns, edges };
  const cycle = findCycle(graph);
  const order = cycle ? null : topoOrder(graph);
  return {
    graph,
    cycle,
    order,
    holds: cycle === null,
    summary: cycle
      ? `The precedence graph has a cycle: ${cycleText(cycle)}.`
      : `Acyclic, so conflict-equivalent to the serial order ${orderText(order!)}.`,
    violations: cycle
      ? [
          {
            text: `Cycle ${cycleText(cycle)}.`,
            ops: edges
              .filter((e) => cycleArcs(cycle).has(`${e.from}>${e.to}`))
              .flatMap((e) => e.ops),
          },
        ]
      : [],
  };
}
// ======================================================= view serializable

/** VSS on the committed projection, where each read sees the latest earlier write. */
export function checkVss(s: Schedule): ViewResult {
  const { ops, txns } = committedProjection(s);
  return viewGraph(ops, txns, latestWriteReadsFrom(ops));
}

// ========================================================== recoverability

interface Dependency {
  writer: number;
  reader: number;
  write: Op;
  read: Op;
}

function position(s: Schedule, t: number, kind: 'C' | 'A'): number | undefined {
  return s.ops.find((o) => o.txn === t && o.kind === kind)?.index;
}

/**
 * Reads-from on the full schedule. A write by a transaction that aborted
 * before the read has been rolled back, so the read sees whatever came before it.
 */
function dependencies(s: Schedule): Dependency[] {
  const out: Dependency[] = [];
  for (const read of s.ops) {
    if (read.kind !== 'R') continue;
    for (let j = read.index - 1; j >= 0; j--) {
      const w = s.ops[j];
      if (w.kind !== 'W' || w.obj !== read.obj) continue;
      const aborted = position(s, w.txn, 'A');
      if (aborted !== undefined && aborted < read.index) continue;
      if (w.txn !== read.txn) out.push({ writer: w.txn, reader: read.txn, write: w, read });
      break;
    }
  }
  return out;
}

function fate(s: Schedule, t: number): string {
  if (s.status[t] === 'aborted') return `${T(t)} aborts`;
  if (s.status[t] === 'active') return `${T(t)} never commits`;
  return `${T(t)} commits only later`;
}

/** Recoverable: if Tj reads from Ti and commits, Ti committed first. */
export function checkRecoverable(s: Schedule): Verdict {
  const violations: Violation[] = [];
  for (const d of dependencies(s)) {
    const cj = position(s, d.reader, 'C');
    if (cj === undefined) continue;
    const ci = position(s, d.writer, 'C');
    if (ci !== undefined && ci < cj) continue;
    violations.push({
      text:
        `${T(d.reader)} reads ${d.read.obj} from ${T(d.writer)} (${opText(d.write)} → ${opText(d.read)}) ` +
        `and commits, but ${fate(s, d.writer)}.`,
      ops: [d.write.index, d.read.index, cj, ...(ci !== undefined ? [ci] : []),
        ...(position(s, d.writer, 'A') !== undefined ? [position(s, d.writer, 'A')!] : [])],
    });
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every transaction commits only after the transactions it read from.'
        : 'A transaction commits before a transaction it read from.',
    violations,
  };
}

/** Avoids cascading aborts: a transaction only reads values whose writer has already committed. */
export function checkAca(s: Schedule): Verdict {
  const violations: Violation[] = [];
  for (const d of dependencies(s)) {
    const ci = position(s, d.writer, 'C');
    if (ci !== undefined && ci < d.read.index) continue;
    violations.push({
      text: `${opText(d.read)} reads ${d.read.obj} written by ${opText(d.write)} before ${T(d.writer)} commits.`,
      ops: [d.write.index, d.read.index, ...(ci !== undefined ? [ci] : [])],
    });
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every read sees committed data only.'
        : 'Some read sees data from a transaction that has not committed.',
    violations,
  };
}

/** Strict: nothing reads or overwrites a value until its writer has committed or aborted. */
export function checkStrict(s: Schedule): Verdict {
  const violations: Violation[] = [];
  for (const op of s.ops) {
    if (op.kind !== 'R' && op.kind !== 'W') continue;
    const flagged = new Set<number>();
    for (let j = 0; j < op.index; j++) {
      const w = s.ops[j];
      if (w.kind !== 'W' || w.obj !== op.obj || w.txn === op.txn || flagged.has(w.txn)) continue;
      const ends = [position(s, w.txn, 'C'), position(s, w.txn, 'A')].filter(
        (p): p is number => p !== undefined,
      );
      const end = ends.length > 0 ? Math.min(...ends) : undefined;
      if (end !== undefined && end < op.index) continue;
      flagged.add(w.txn);
      violations.push({
        text:
          `${opText(op)} ${op.kind === 'R' ? 'reads' : 'overwrites'} ${op.obj}, written by ` +
          `${opText(w)}, before ${T(w.txn)} commits or aborts.`,
        ops: [w.index, op.index, ...(end !== undefined ? [end] : [])],
      });
    }
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every value is read or overwritten only after its writer finished.'
        : 'A value is read or overwritten while its writer is still running.',
    violations,
  };
}

// ================================================================ summary

export interface Analysis {
  serial: Verdict;
  css: CssResult;
  vss: ViewResult;
  recoverable: Verdict;
  aca: Verdict;
  strict: Verdict;
  notes: string[];
}

export function analyse(s: Schedule): Analysis {
  const notes: string[] = [];
  const aborted = s.txns.filter((t) => s.status[t] === 'aborted');
  const active = s.txns.filter((t) => s.status[t] === 'active');
  if (aborted.length > 0) {
    notes.push(
      `${aborted.map(T).join(', ')} abort${aborted.length === 1 ? 's' : ''}: left out of the CSS and ` +
        `VSS graphs (committed projection), but counted for recoverability.`,
    );
  }
  if (active.length > 0) {
    notes.push(
      `${active.map(T).join(', ')} ${active.length === 1 ? 'has' : 'have'} no commit or abort: ` +
        `treated as committed for CSS and VSS, and as not yet committed for recoverability.`,
    );
  }
  return {
    serial: checkSerial(s),
    css: checkCss(s),
    vss: checkVss(s),
    recoverable: checkRecoverable(s),
    aca: checkAca(s),
    strict: checkStrict(s),
    notes,
  };
}
