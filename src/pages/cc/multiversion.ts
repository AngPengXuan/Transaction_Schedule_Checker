/**
 * The MVCC page's checks, on a multiversion schedule: each read may name the
 * version it sees (R1,2(A) -- T1 reads T2's version of A); a plain read sees
 * the latest earlier write, as in a monoversion schedule.
 */
import { cycleText, orderText } from '../../core/format';
import { addEdge, cycleArcs, findCycle, topoOrder } from '../../core/graph';
import type { Edge, Graph } from '../../core/graph';
import { viewGraph } from '../../core/polygraph';
import type { ReadsFrom, ViewResult, ViewStyle } from '../../core/polygraph';
import { concurrent, lastWriteBefore, lifetimes } from '../../core/protocols/lifetime';
import { checkFirstCommitterWins, checkSnapshotReads, seenVersion, snapshotVersion } from '../../core/protocols/si';
import { committedProjection, opInput, opText, T0, txnName } from '../../core/schedule';
import type { Op, Schedule } from '../../core/schedule';
import type { Verdict, Violation } from '../../core/verdict';
import { checkVss } from '../classic/analysis';

const T = txnName;

function versionName(t: number, obj: string): string {
  return t === T0 ? `the initial ${obj}` : `${T(t)}'s version of ${obj}`;
}

// ============================================================ reads-from

interface MvReads {
  /** Reads-from over the committed projection, for the polygraph and the serialization graph. */
  rf: ReadsFrom[];
  /** Committed reads of a version whose writer later aborted. */
  aborted: Violation[];
}

/**
 * Who each read reads from. A named version is that transaction's latest
 * write of the object before the read; a plain read is the latest earlier
 * write. Reads by aborted transactions are dropped (committed projection).
 */
function mvReadsFrom(s: Schedule): MvReads {
  const { ops } = committedProjection(s);
  const rf: ReadsFrom[] = [];
  const aborted: Violation[] = [];
  for (const read of ops) {
    if (read.kind !== 'R') continue;
    const v = seenVersion(s, read);
    if (v === T0) {
      rf.push({ reader: read.txn, read, writer: T0, write: null });
      continue;
    }
    if (s.status[v] === 'aborted') {
      const w = lastWriteBefore(s.ops, v, read.obj!, read.index)!;
      aborted.push({
        text: `${opText(read)} reads ${versionName(v, read.obj!)} (${opText(w)}), but ${T(v)} aborts, so that version never existed in the committed state.`,
        ops: [w.index, read.index],
      });
      continue;
    }
    rf.push({ reader: read.txn, read, writer: v, write: lastWriteBefore(ops, v, read.obj!, read.index)! });
  }
  return { rf, aborted };
}

// ================================================================ checks

/** Monoversion: every read sees the latest earlier write, as if only one version existed. */
function checkMonoversion(s: Schedule): Verdict {
  const { ops } = committedProjection(s);
  const violations: Violation[] = [];
  for (const read of ops) {
    if (read.kind !== 'R' || read.version === undefined) continue;
    let latest: Op | null = null;
    for (const o of ops) {
      if (o.index >= read.index) break;
      if (o.kind === 'W' && o.obj === read.obj) latest = o;
    }
    const latestTxn = latest ? latest.txn : T0;
    if (latestTxn === read.version) continue;
    violations.push({
      text:
        `${opText(read)} reads ${versionName(read.version, read.obj!)}, but the latest write ` +
        `before it is ${latest ? `${opText(latest)} (step ${latest.index + 1})` : 'none'}.`,
      ops: [read.index, ...(latest ? [latest.index] : [])],
    });
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'Every read sees the latest earlier write: this is an ordinary (monoversion) schedule.'
        : 'Some read sees an older version than the latest write.',
    violations,
  };
}

/** VSS applies only to monoversion schedules; for those, it is the classic check. */
function checkMonoversionVss(s: Schedule, mono: Verdict, reads: MvReads, style: ViewStyle): Verdict {
  if (reads.aborted.length > 0) {
    return {
      holds: false,
      summary: 'A committed transaction read a version written by a transaction that aborts.',
      violations: reads.aborted,
    };
  }
  if (!mono.holds) {
    return {
      holds: false,
      summary: 'Not a monoversion schedule, so not VSS: some read sees an older version.',
      violations: [],
    };
  }
  const vss = checkVss(s, style);
  return { holds: vss.holds, summary: vss.summary, violations: vss.violations };
}

/**
 * MVSS: view-equivalent to a serial monoversion schedule, comparing reads-from
 * only -- under multiversioning the final version is fixed by the version
 * order, not by which write happened last, so there is no final-write condition.
 */
function checkMvss(s: Schedule, reads: MvReads, style: ViewStyle): ViewResult {
  const { ops, txns } = committedProjection(s);
  const result = viewGraph(ops, txns, reads.rf, { finalWrites: false, style });
  if (reads.aborted.length === 0) return result;
  return {
    ...result,
    holds: false,
    summary: 'A committed transaction read a version written by a transaction that aborts.',
    violations: reads.aborted,
  };
}

// ==================================================== serialization graph

export interface DsgResult extends Verdict {
  graph: Graph;
  cycle: number[] | null;
  order: number[] | null;
  /** Each object's versions in version order (commit order), T0 first. */
  versionOrder: { obj: string; writers: number[] }[];
  rw: Edge[];
}

/**
 * The serialization graph over committed transactions, with version order =
 * commit order (as under SI):
 *   wr  Ti → Tj  Tj reads Ti's version
 *   ww  Ti → Tj  Tj writes the next version after Ti's
 *   rw  Ti → Tj  Ti reads a version that Tj's version directly follows (anti-dependency)
 * Acyclic means serializable in that version order.
 */
function serializationGraph(s: Schedule, reads: MvReads): DsgResult {
  const { ops, txns } = committedProjection(s);
  const life = lifetimes(s);
  const commitAt = (t: number) => life.get(t)!.commit ?? s.ops.length + txns.indexOf(t);
  const versionOrder = s.objects
    .map((obj) => ({
      obj,
      writers: [
        T0,
        ...txns
          .filter((t) => ops.some((o) => o.kind === 'W' && o.txn === t && o.obj === obj))
          .sort((a, b) => commitAt(a) - commitAt(b)),
      ],
    }))
    .filter((v) => v.writers.length > 1);

  const edges: Edge[] = [];
  for (const { obj, writers } of versionOrder) {
    for (let k = 2; k < writers.length; k++) {
      const [a, b] = [writers[k - 1], writers[k]];
      addEdge(edges, {
        from: a,
        to: b,
        rule: 'ww',
        ops: ops.filter((o) => o.kind === 'W' && o.obj === obj && (o.txn === a || o.txn === b)).map((o) => o.index),
        reasons: [`${T(b)}'s version of ${obj} comes next after ${T(a)}'s (${T(a)} commits first)`],
      });
    }
  }
  const intermediate: Violation[] = [];
  for (const r of reads.rf) {
    const obj = r.read.obj!;
    if (r.writer !== r.reader && r.writer !== T0) {
      addEdge(edges, {
        from: r.writer,
        to: r.reader,
        rule: 'wr',
        ops: [r.write!.index, r.read.index],
        reasons: [`${T(r.reader)} reads ${T(r.writer)}'s version of ${obj} (${opText(r.read)})`],
      });
      const own = ops.find((o) => o.kind === 'W' && o.txn === r.reader && o.obj === obj && o.index < r.read.index);
      if (own) {
        intermediate.push({
          text: `${opText(r.read)} reads ${T(r.writer)}'s version of ${obj} although ${T(r.reader)} already wrote ${obj} itself (${opText(own)}): in any serial order it would see its own write.`,
          ops: [own.index, r.write!.index, r.read.index],
        });
      }
      const later = ops.find((o) => o.kind === 'W' && o.txn === r.writer && o.obj === obj && o.index > r.write!.index);
      if (later) {
        intermediate.push({
          text: `${opText(r.read)} reads an intermediate version: ${T(r.writer)} writes ${obj} again (${opText(later)}), so no serial order shows ${T(r.reader)} that value.`,
          ops: [r.write!.index, r.read.index, later.index],
        });
      }
    }
    const order = versionOrder.find((v) => v.obj === obj)?.writers ?? [T0];
    const next = order[order.indexOf(r.writer) + 1];
    if (next !== undefined && next !== r.reader) {
      addEdge(edges, {
        from: r.reader,
        to: next,
        rule: 'rw',
        ops: [r.read.index, ...ops.filter((o) => o.kind === 'W' && o.txn === next && o.obj === obj).map((o) => o.index)],
        reasons: [
          `${T(r.reader)} reads ${versionName(r.writer, obj)} (${opText(r.read)}), which ${T(next)}'s version directly follows`,
        ],
      });
    }
  }

  const graph = { nodes: txns, edges };
  const cycle = findCycle(graph);
  const order = cycle ? null : topoOrder(graph);
  intermediate.push(...reads.aborted);
  const holds = cycle === null && intermediate.length === 0;
  return {
    graph,
    cycle,
    order,
    versionOrder,
    rw: edges.filter((e) => e.rule === 'rw'),
    holds,
    summary: cycle
      ? `The serialization graph has a cycle: ${cycleText(cycle)}.`
      : intermediate.length > 0
        ? 'Acyclic, but some read sees a version no serial order could show it.'
        : `Acyclic, so serializable as ${orderText(order!)}.`,
    violations: [
      ...(cycle
        ? [
            {
              text: `Cycle ${cycleText(cycle)}.`,
              ops: edges.filter((e) => cycleArcs(cycle).has(`${e.from}>${e.to}`)).flatMap((e) => e.ops),
            },
          ]
        : []),
      ...intermediate,
    ],
  };
}

/**
 * Serializable SI's test: a dangerous structure is two consecutive rw
 * anti-dependencies Tin → Tpivot → Tout between concurrent transactions
 * (Tin may be Tout). Every non-serializable SI schedule has one, so SSI
 * aborts the pivot.
 */
function checkSsi(s: Schedule, dsg: DsgResult): Verdict {
  const life = lifetimes(s);
  const conc = (a: number, b: number) => concurrent(life.get(a)!, life.get(b)!);
  const violations: Violation[] = [];
  for (const pivot of dsg.graph.nodes) {
    const into = dsg.rw.find((e) => e.to === pivot && conc(e.from, pivot));
    const out = dsg.rw.find((e) => e.from === pivot && conc(pivot, e.to));
    if (!into || !out) continue;
    violations.push({
      text:
        `${T(into.from)} →rw ${T(pivot)} →rw ${T(out.to)}, each pair concurrent: ${T(pivot)} is a ` +
        `pivot, so SSI would abort it.`,
      ops: [...into.ops, ...out.ops],
    });
  }
  return {
    holds: violations.length === 0,
    summary:
      violations.length === 0
        ? 'No dangerous structure: no transaction has rw anti-dependencies both in and out with concurrent transactions.'
        : 'A dangerous structure: SSI would abort the pivot.',
    violations,
  };
}

// ======================================================== recoverability

interface Dependency {
  writer: number;
  reader: number;
  write: Op;
  read: Op;
}

function dependencies(s: Schedule): Dependency[] {
  const out: Dependency[] = [];
  for (const read of s.ops) {
    if (read.kind !== 'R') continue;
    const v = seenVersion(s, read);
    if (v === T0 || v === read.txn) continue;
    out.push({ writer: v, reader: read.txn, write: lastWriteBefore(s.ops, v, read.obj!, read.index)!, read });
  }
  return out;
}

function checkRecoverable(s: Schedule): Verdict {
  const life = lifetimes(s);
  const violations: Violation[] = [];
  for (const d of dependencies(s)) {
    const cj = life.get(d.reader)!.commit;
    if (cj === null) continue;
    const ci = life.get(d.writer)!.commit;
    if (ci !== null && ci < cj) continue;
    violations.push({
      text:
        `${T(d.reader)} reads ${versionName(d.writer, d.read.obj!)} (${opText(d.read)}) and commits, but ` +
        `${T(d.writer)} ${s.status[d.writer] === 'aborted' ? 'aborts' : ci === null ? 'never commits' : 'commits only later'}.`,
      ops: [d.write.index, d.read.index, cj, ...(ci !== null ? [ci] : [])],
    });
  }
  return {
    holds: violations.length === 0,
    summary: violations.length === 0
      ? 'Every transaction commits only after the transactions whose versions it read.'
      : 'A transaction commits before a transaction whose version it read.',
    violations,
  };
}

function checkAca(s: Schedule): Verdict {
  const life = lifetimes(s);
  const violations: Violation[] = [];
  for (const d of dependencies(s)) {
    const ci = life.get(d.writer)!.commit;
    if (ci !== null && ci < d.read.index) continue;
    violations.push({
      text: `${opText(d.read)} reads ${versionName(d.writer, d.read.obj!)} before ${T(d.writer)} commits.`,
      ops: [d.write.index, d.read.index, ...(ci !== null ? [ci] : [])],
    });
  }
  return {
    holds: violations.length === 0,
    summary: violations.length === 0
      ? 'Every read sees a committed version (or its own write).'
      : 'Some read sees an uncommitted version.',
    violations,
  };
}

// =============================================================== summary

export interface MvAnalysis {
  monoversion: Verdict;
  vss: Verdict;
  mvss: ViewResult;
  snapshotReads: Verdict;
  fcw: Verdict;
  si: Verdict;
  dsg: DsgResult;
  ssi: Verdict;
  aca: Verdict;
  recoverable: Verdict;
  notes: string[];
}

export function analyseMv(s: Schedule, style: ViewStyle = 'lecture'): MvAnalysis {
  const reads = mvReadsFrom(s);
  const monoversion = checkMonoversion(s);
  const snapshot = checkSnapshotReads(s);
  const fcw = checkFirstCommitterWins(s);
  const dsg = serializationGraph(s, reads);
  const notes: string[] = [];
  const aborted = s.txns.filter((t) => s.status[t] === 'aborted');
  if (aborted.length > 0) {
    notes.push(`${aborted.map(T).join(', ')} abort${aborted.length === 1 ? 's' : ''}: left out of MVSS and the serialization graph.`);
  }
  if (s.ops.some((o) => o.kind === 'R' && o.version === undefined)) {
    notes.push('Reads without a version see the latest earlier write.');
  }
  return {
    monoversion,
    vss: checkMonoversionVss(s, monoversion, reads, style),
    mvss: checkMvss(s, reads, style),
    snapshotReads: snapshot,
    fcw,
    si: {
      holds: snapshot.holds && fcw.holds,
      summary:
        snapshot.holds && fcw.holds
          ? 'Allowed under snapshot isolation: snapshot reads, and first-committer-wins holds.'
          : !snapshot.holds && !fcw.holds
            ? 'Not allowed: a read breaks its snapshot, and first-committer-wins fails.'
            : !snapshot.holds
              ? 'Not allowed: a read breaks its snapshot.'
              : 'Not allowed: first-committer-wins fails.',
      violations: [],
    },
    dsg,
    ssi: checkSsi(s, dsg),
    aca: checkAca(s),
    recoverable: checkRecoverable(s),
    notes,
  };
}

/** The schedule rewritten so that every read names the version SI would give it. */
export function withSnapshotVersions(s: Schedule): string {
  const life = lifetimes(s);
  return s.ops
    .map((o) =>
      opInput(o.kind === 'R' ? { ...o, version: snapshotVersion(s, o, life.get(o.txn)!.start, life) } : o),
    )
    .join(' ');
}
