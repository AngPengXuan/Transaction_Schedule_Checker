/**
 * Directed graphs over transaction ids: the edge model both precedence graphs
 * share, cycle finding, and topological order (the equivalent serial order).
 */

/** Conflict edges (CSS) or the view-serializability rule that produced the edge (VSS). */
export type EdgeRule = 'rw' | 'wr' | 'ww' | 'a' | 'b' | 'c-forced' | 'c';

export interface Edge {
  from: number;
  to: number;
  rule: EdgeRule;
  /** Operations behind the edge, as indexes into the full schedule. */
  ops: number[];
  /** Why the edge exists, one line per reason. */
  reasons: string[];
}

export interface Graph {
  nodes: number[];
  edges: Edge[];
}

/**
 * Adds `edge`, merging it into an existing edge with the same endpoints and
 * rule so a pair of transactions with three R-W conflicts draws one arrow.
 */
export function addEdge(edges: Edge[], edge: Edge) {
  const same = edges.find((e) => e.from === edge.from && e.to === edge.to && e.rule === edge.rule);
  if (!same) {
    edges.push({ ...edge, ops: [...edge.ops], reasons: [...edge.reasons] });
    return;
  }
  for (const op of edge.ops) if (!same.ops.includes(op)) same.ops.push(op);
  for (const r of edge.reasons) if (!same.reasons.includes(r)) same.reasons.push(r);
}

export function hasArc(edges: Edge[], from: number, to: number): boolean {
  return edges.some((e) => e.from === from && e.to === to);
}

function adjacency(g: Graph): Map<number, number[]> {
  const adj = new Map<number, number[]>(g.nodes.map((n) => [n, []]));
  for (const e of g.edges) {
    const out = adj.get(e.from)!;
    if (!out.includes(e.to)) out.push(e.to);
  }
  for (const out of adj.values()) out.sort((a, b) => a - b);
  return adj;
}

/** One cycle as a node list [a, b, ..., a], or null when the graph is acyclic. */
export function findCycle(g: Graph): number[] | null {
  const adj = adjacency(g);
  const state = new Map<number, 'open' | 'done'>();
  const stack: number[] = [];

  const visit = (n: number): number[] | null => {
    state.set(n, 'open');
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 'open') return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, 'done');
    return null;
  };

  for (const n of g.nodes) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return null;
}

/** Kahn's algorithm, lowest id first among ties; null if there is a cycle. */
export function topoOrder(g: Graph): number[] | null {
  const adj = adjacency(g);
  const indeg = new Map<number, number>(g.nodes.map((n) => [n, 0]));
  for (const out of adj.values()) for (const m of out) indeg.set(m, indeg.get(m)! + 1);
  const ready = g.nodes.filter((n) => indeg.get(n) === 0);
  const order: number[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const n = ready.shift()!;
    order.push(n);
    for (const m of adj.get(n)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  return order.length === g.nodes.length ? order : null;
}

/** Arcs of `cycle` as "from>to" keys, for highlighting. */
export function cycleArcs(cycle: number[] | null): Set<string> {
  const out = new Set<string>();
  if (!cycle) return out;
  for (let i = 0; i + 1 < cycle.length; i++) out.add(`${cycle[i]}>${cycle[i + 1]}`);
  return out;
}
