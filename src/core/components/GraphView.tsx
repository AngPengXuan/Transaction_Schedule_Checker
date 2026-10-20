import { useId, useMemo, useState } from 'react';
import type { Edge, EdgeRule } from '../graph';
import { cycleArcs } from '../graph';
import { isVirtual, txnName } from '../schedule';
import './GraphView.css';

const RULE_LABEL: Record<EdgeRule, string> = {
  wr: 'W → R conflict',
  rw: 'R → W conflict',
  ww: 'W → W conflict',
  a: '(a) reads from',
  b: '(b) final write',
  'c-forced': '(c) forced',
  c: '(c) chosen',
};

interface Props {
  nodes: number[];
  edges: Edge[];
  cycle: number[] | null;
  /** Reports the operations behind the edge under the pointer, or null when it leaves. */
  onHover?: (ops: number[] | null) => void;
  compact?: boolean;
  /** Overrides for the rule names shown on hover, e.g. the lecture's wording. */
  labels?: Partial<Record<EdgeRule, string>>;
}

const NODE_R = 19;

interface Placed {
  edge: Edge;
  d: string;
  label: { x: number; y: number };
  onCycle: boolean;
}

/**
 * Transactions on a circle, T0 (when present) at the top and Tf (when present) last. Several edges
 * between one pair -- opposite directions, or different rules -- bow apart
 * so each keeps its own colour.
 */
function layout(nodes: number[], edges: Edge[], cycle: number[] | null) {
  const radius = Math.max(62, nodes.length * 21);
  const center = radius + NODE_R + 14;
  const pos = new Map<number, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
    pos.set(n, {
      x: nodes.length === 1 ? center : center + radius * Math.cos(angle),
      y: nodes.length === 1 ? center : center + radius * Math.sin(angle),
    });
  });

  const pairKey = (e: Edge) => {
    const [a, b] = nodes.indexOf(e.from) < nodes.indexOf(e.to) ? [e.from, e.to] : [e.to, e.from];
    return `${a}-${b}`;
  };
  const byPair = new Map<string, Edge[]>();
  for (const e of edges) byPair.set(pairKey(e), [...(byPair.get(pairKey(e)) ?? []), e]);

  const arcs = cycleArcs(cycle);
  const placed: Placed[] = [];
  for (const group of byPair.values()) {
    group.sort((x, y) => x.from - y.from || x.rule.localeCompare(y.rule));
    group.forEach((edge, k) => {
      const a = pos.get(edge.from)!;
      const b = pos.get(edge.to)!;
      // Bow relative to the pair's canonical direction, so A→B and B→A separate.
      const forward = nodes.indexOf(edge.from) < nodes.indexOf(edge.to);
      const [p, q] = forward ? [a, b] : [b, a];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const nx = -(q.y - p.y) / len;
      const ny = (q.x - p.x) / len;
      const bow = group.length === 1 ? 0 : (k - (group.length - 1) / 2) * 30;
      const cx = (a.x + b.x) / 2 + nx * bow;
      const cy = (a.y + b.y) / 2 + ny * bow;
      const toward = (from: { x: number; y: number }, gap: number) => {
        const dx = cx - from.x;
        const dy = cy - from.y;
        const l = Math.hypot(dx, dy) || 1;
        return { x: from.x + (dx / l) * gap, y: from.y + (dy / l) * gap };
      };
      const s = toward(a, NODE_R + 2);
      const t = toward(b, NODE_R + 6);
      placed.push({
        edge,
        d: `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`,
        label: { x: (s.x + 2 * cx + t.x) / 4, y: (s.y + 2 * cy + t.y) / 4 },
        onCycle: arcs.has(`${edge.from}>${edge.to}`),
      });
    });
  }
  return { size: center * 2, pos, placed };
}

export function GraphView({ nodes, edges, cycle, onHover, compact, labels }: Props) {
  const id = useId().replace(/:/g, '');
  const { size, pos, placed } = useMemo(() => layout(nodes, edges, cycle), [nodes, edges, cycle]);
  const [hovered, setHovered] = useState<Edge | null>(null);
  const rules = [...new Set(edges.map((e) => e.rule))];

  function hover(edge: Edge | null) {
    setHovered(edge);
    onHover?.(edge ? edge.ops : null);
  }

  return (
    <div className={`graph ${compact ? 'compact' : ''}`}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Precedence graph">
        <defs>
          {rules.map((rule) => (
            <marker
              key={rule}
              id={`${id}-${rule}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className={`arrow rule-${rule}`} />
            </marker>
          ))}
        </defs>

        {placed
          .filter((p) => p.onCycle)
          .map((p, i) => (
            <path key={`halo-${i}`} d={p.d} className="cycle-halo" />
          ))}

        {placed.map((p, i) => (
          <g
            key={i}
            className={`edge rule-${p.edge.rule} ${hovered === p.edge ? 'hovered' : ''}`}
            onMouseEnter={() => hover(p.edge)}
            onMouseLeave={() => hover(null)}
          >
            <path d={p.d} className="edge-line" markerEnd={`url(#${id}-${p.edge.rule})`} />
            <path d={p.d} className="edge-hit" />
          </g>
        ))}

        {nodes.map((n) => {
          const { x, y } = pos.get(n)!;
          return (
            <g key={n} className={`node ${isVirtual(n) ? 'virtual' : ''}`} transform={`translate(${x},${y})`}>
              <circle r={NODE_R} />
              <text textAnchor="middle" dominantBaseline="central">
                {txnName(n)}
              </text>
            </g>
          );
        })}
      </svg>
      {!compact && (
        <p className="edge-caption">
          {hovered ? (
            <>
              <strong className={`rule-text rule-${hovered.rule}`}>
                {txnName(hovered.from)} → {txnName(hovered.to)} ·{' '}
                {labels?.[hovered.rule] ?? RULE_LABEL[hovered.rule]}
              </strong>
              <br />
              {hovered.reasons.join('; ')}.
            </>
          ) : edges.length === 0 ? (
            'No edges.'
          ) : (
            'Hover over an edge to see why it is there.'
          )}
        </p>
      )}
    </div>
  );
}

export function Legend({
  rules,
  labels,
}: {
  rules: EdgeRule[];
  labels?: Partial<Record<EdgeRule, string>>;
}) {
  return (
    <div className="legend">
      {rules.map((rule) => (
        <span key={rule} className="legend-item">
          <svg width="28" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="27" y2="5" className={`legend-line rule-${rule}`} />
          </svg>
          {labels?.[rule] ?? RULE_LABEL[rule]}
        </span>
      ))}
      <span className="legend-item">
        <svg width="28" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="27" y2="5" className="legend-cycle" />
        </svg>
        on a cycle
      </span>
    </div>
  );
}
