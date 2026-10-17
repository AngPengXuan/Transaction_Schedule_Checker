/**
 * The view-serializability polygraph, shared by every page. It takes the
 * reads-from relation as input rather than deriving it, so a monoversion
 * schedule (each read sees the latest write) and a multiversion one (each read
 * names its version) go through the same rules, choices and graph drawing.
 */
import { cycleText, orderText } from './format';
import { addEdge, findCycle, hasArc, topoOrder } from './graph';
import type { Edge, Graph } from './graph';
import { opText, T0, txnName } from './schedule';
import type { Op } from './schedule';
import type { Verdict } from './verdict';

const T = txnName;

export interface ReadsFrom {
  reader: number;
  read: Op;
  /** T0 when the read sees the initial value. */
  writer: number;
  write: Op | null;
}

/** Monoversion reads-from: each read sees the latest earlier write of its object, or T0. */
export function latestWriteReadsFrom(ops: Op[]): ReadsFrom[] {
  const out: ReadsFrom[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== 'R') return;
    let write: Op | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ops[j].kind === 'W' && ops[j].obj === op.obj) {
        write = ops[j];
        break;
      }
    }
    out.push({ reader: op.txn, read: op, writer: write ? write.txn : T0, write });
  });
  return out;
}

export interface Choice {
  id: number;
  options: [Edge, Edge];
  /** Which option an existing edge already provides, if any; such a choice costs nothing. */
  satisfiedBy: 0 | 1 | null;
}

export interface ViewGraph {
  graph: Graph;
  /** For each open choice, in order, the option this graph takes. */
  picks: (0 | 1)[];
  cycle: number[] | null;
  order: number[] | null;
}

export interface ViewResult extends Verdict {
  nodes: number[];
  /** Edges every graph has: rules (a) and (b), and rule (c) choices T0 forces. */
  base: Edge[];
  choices: Choice[];
  open: Choice[];
  graphs: ViewGraph[];
  /** 2^(open choices), before identical graphs are merged. */
  combinations: number;
  truncated: boolean;
  /** View-equivalent serial orders found by brute force, or null when there are too many transactions to try. */
  serialOrders: number[][] | null;
}

const MAX_OPEN_CHOICES = 10;
const MAX_BRUTE_FORCE_TXNS = 7;

function arcKey(e: { from: number; to: number }): string {
  return `${e.from}>${e.to}`;
}

export interface ViewOptions {
  /**
   * Rule (b): the same final writer for every object. On for monoversion view
   * serializability; a multiversion definition may compare reads-from alone.
   */
  finalWrites: boolean;
}

/**
 * The labelled precedence graph over `ops` (already the committed projection),
 * with T0 as the writer of every initial value:
 *   (a) Tj reads O from Ti            ⇒ Ti → Tj
 *   (b) Ti makes the final write on O ⇒ Tj → Ti for every other Tj updating O (T0 included)
 *   (c) Tj reads O from Tk, Ti updates O ⇒ Ti → Tk or Tj → Ti
 * When Tk is T0, Ti → T0 is impossible, so (c) forces Tj → Ti. The schedule
 * is view serializable iff some way of resolving the remaining choices is acyclic.
 */
export function viewGraph(
  ops: Op[],
  txns: number[],
  rf: ReadsFrom[],
  { finalWrites }: ViewOptions = { finalWrites: true },
): ViewResult {
  const nodes = [T0, ...txns];
  const writersOf = (obj: string) =>
    [...new Set(ops.filter((o) => o.kind === 'W' && o.obj === obj).map((o) => o.txn))];
  const writesBy = (t: number, obj: string) =>
    ops.filter((o) => o.kind === 'W' && o.obj === obj && o.txn === t).map((o) => o.index);
  const source = (r: ReadsFrom) => (r.write ? opText(r.write) : 'the initial value');

  const base: Edge[] = [];

  // (a) reads-from
  for (const r of rf) {
    if (r.writer === r.reader) continue;
    addEdge(base, {
      from: r.writer,
      to: r.reader,
      rule: 'a',
      ops: r.write ? [r.write.index, r.read.index] : [r.read.index],
      reasons: [`${T(r.reader)} reads ${r.read.obj} from ${T(r.writer)} (${source(r)} → ${opText(r.read)})`],
    });
  }

  // (b) final writes
  const objects = [...new Set(ops.filter((o) => o.obj !== null).map((o) => o.obj!))].sort();
  for (const obj of finalWrites ? objects : []) {
    const writes = ops.filter((o) => o.kind === 'W' && o.obj === obj);
    if (writes.length === 0) continue;
    const final = writes[writes.length - 1];
    for (const u of [T0, ...writersOf(obj)]) {
      if (u === final.txn) continue;
      addEdge(base, {
        from: u,
        to: final.txn,
        rule: 'b',
        ops: [...writesBy(u, obj), final.index],
        reasons: [
          `${T(final.txn)} makes the final write on ${obj} (${opText(final)}), and ${T(u)} ` +
            (u === T0 ? `wrote its initial value` : `also updates ${obj}`),
        ],
      });
    }
  }

  // (c) a third transaction must not slip between a read and its source
  const choices: Choice[] = [];
  for (const r of rf) {
    if (r.writer === r.reader) continue;
    const obj = r.read.obj!;
    for (const i of writersOf(obj)) {
      if (i === r.writer) {
        // Ti = Tk: Tk writes O again after the write Tj read. Serially Tk runs
        // whole, so that later write always lands between -- Ti → Tk would be
        // Tk → Tk, leaving only Tj → Tk, which closes a cycle with (a) Tk → Tj.
        const later = ops.find(
          (o) => o.txn === i && o.kind === 'W' && o.obj === obj && o.index > r.write!.index,
        );
        if (later) {
          addEdge(base, {
            from: r.reader,
            to: r.writer,
            rule: 'c-forced',
            ops: [r.write!.index, r.read.index, later.index],
            reasons: [
              `${T(r.reader)} reads ${obj} from ${T(r.writer)} (${source(r)} → ${opText(r.read)}), ` +
                `and ${T(i)} updates ${obj} again (${opText(later)}, step ${later.index + 1}); with ` +
                `Ti = Tk, ${T(i)} → ${T(r.writer)} is impossible, so ${T(r.reader)} → ${T(r.writer)}`,
            ],
          });
        }
        continue;
      }
      if (i === r.reader) {
        // Ti = Tj: the reader's own write must not fall between Tk's write and
        // the read. In a serial order it does exactly when it comes before the
        // read inside Tj -- then the only option left is Tj → Tk, which closes
        // a cycle with the (a) edge Tk → Tj: no serial order can give this read.
        const ownEarlier = ops.find(
          (o) => o.txn === r.reader && o.kind === 'W' && o.obj === obj && o.index < r.read.index,
        );
        if (ownEarlier) {
          addEdge(base, {
            from: r.reader,
            to: r.writer,
            rule: 'c-forced',
            ops: [ownEarlier.index, ...(r.write ? [r.write.index] : []), r.read.index],
            reasons: [
              `${T(r.reader)} reads ${obj} from ${T(r.writer)} (${source(r)} → ${opText(r.read)}) ` +
                `but already wrote ${obj} itself (${opText(ownEarlier)}); ${T(r.reader)} → ` +
                `${T(r.reader)} is impossible, so ${T(r.reader)} → ${T(r.writer)}`,
            ],
          });
        }
        continue;
      }
      const opsBehind = [...(r.write ? [r.write.index] : []), r.read.index, ...writesBy(i, obj)];
      const why = `${T(r.reader)} reads ${obj} from ${T(r.writer)} (${source(r)} → ${opText(r.read)}) and ${T(i)} updates ${obj}`;
      if (r.writer === T0) {
        addEdge(base, {
          from: r.reader,
          to: i,
          rule: 'c-forced',
          ops: opsBehind,
          reasons: [`${why}; ${T(i)} → T0 is impossible, so ${T(r.reader)} → ${T(i)}`],
        });
        continue;
      }
      const options: [Edge, Edge] = [
        { from: i, to: r.writer, rule: 'c', ops: opsBehind, reasons: [why] },
        { from: r.reader, to: i, rule: 'c', ops: opsBehind, reasons: [why] },
      ];
      const same = choices.find(
        (c) => arcKey(c.options[0]) === arcKey(options[0]) && arcKey(c.options[1]) === arcKey(options[1]),
      );
      if (same) {
        for (const k of [0, 1] as const) addEdge([same.options[k]], options[k]);
        continue;
      }
      choices.push({ id: choices.length + 1, options, satisfiedBy: null });
    }
  }
  for (const c of choices) {
    if (hasArc(base, c.options[0].from, c.options[0].to)) c.satisfiedBy = 0;
    else if (hasArc(base, c.options[1].from, c.options[1].to)) c.satisfiedBy = 1;
  }
  const open = choices.filter((c) => c.satisfiedBy === null);

  // Every way of resolving the open choices; graphs with the same arcs are one graph.
  const enumerated = Math.min(open.length, MAX_OPEN_CHOICES);
  const combinations = 2 ** open.length;
  const seen = new Set<string>();
  const graphs: ViewGraph[] = [];
  for (let mask = 0; mask < 2 ** enumerated; mask++) {
    const picks = open.map((_, k) => (k < enumerated ? (((mask >> k) & 1) as 0 | 1) : 0));
    const edges: Edge[] = [...base];
    open.forEach((c, k) => addEdge(edges, c.options[picks[k]]));
    const key = [...new Set(edges.map(arcKey))].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const graph = { nodes, edges };
    const cycle = findCycle(graph);
    graphs.push({ graph, picks, cycle, order: cycle ? null : topoOrder(graph) });
  }
  graphs.sort((a, b) => Number(a.cycle !== null) - Number(b.cycle !== null));

  const acyclic = graphs.find((g) => g.cycle === null);
  const serialOrders =
    txns.length <= MAX_BRUTE_FORCE_TXNS ? viewEquivalentOrders(ops, txns, rf, finalWrites) : null;
  const holds = acyclic !== undefined;
  return {
    nodes,
    base,
    choices,
    open,
    graphs,
    combinations,
    truncated: open.length > MAX_OPEN_CHOICES,
    serialOrders,
    holds,
    summary: holds
      ? `An acyclic graph exists, so it is view-equivalent to ${orderText(acyclic.order!)}.`
      : graphs.length === 1
        ? `The graph has a cycle: ${cycleText(graphs[0].cycle!)}.`
        : `Every one of the ${graphs.length} possible graphs has a cycle.`,
    violations: [],
  };
}

/**
 * Ground truth by trying every serial order: each read must see the same
 * write operation it saw in the schedule (reading T1's first write of X is not
 * reading its last), and, with `finalWrites`, each object must end with the
 * same writer. Ops keep their original index when reordered, which is what
 * identifies a read and the write it saw.
 */
function signature(rf: ReadsFrom[], ops: Op[], finalWrites: boolean): string {
  const reads = rf.map((r) => `${r.read.index}<${r.write ? r.write.index : 'T0'}`).sort();
  const finals = new Map<string, number>();
  if (finalWrites) for (const op of ops) if (op.kind === 'W') finals.set(op.obj!, op.txn);
  return [
    reads.join(','),
    [...finals.entries()]
      .sort()
      .map(([o, t]) => `${o}=${t}`)
      .join(','),
  ].join('|');
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

/** Serial orders whose monoversion execution reproduces the reads-from `rf`. */
export function viewEquivalentOrders(
  ops: Op[],
  txns: number[],
  rf: ReadsFrom[],
  finalWrites: boolean,
): number[][] {
  const target = signature(rf, ops, finalWrites);
  return permutations(txns).filter((order) => {
    const serial = order.flatMap((t) => ops.filter((o) => o.txn === t));
    return signature(latestWriteReadsFrom(serial), serial, finalWrites) === target;
  });
}
