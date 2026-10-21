import { useState } from 'react';
import { arcText, orderText } from '../format';
import type { EdgeRule } from '../graph';
import type { Choice, ViewGraph, ViewResult, ViewStyle } from '../polygraph';
import { txnName } from '../schedule';
import { VIEW_STYLES } from '../viewStyle';
import { ChoiceRow, EdgeRows } from './Cards';
import { GraphView, Legend } from './GraphView';

const GRAPHS_SHOWN = 12;

interface Props {
  title: string;
  result: ViewResult;
  style: ViewStyle;
  onStyle: (next: ViewStyle) => void;
  onHover: (ops: number[] | null) => void;
  /**
   * Whether the graph enforces the final-write condition: Tf (AY26/27 Sem 1)
   * or rule (b) (AY25/26 Sem 2). Off for multiversion view serializability,
   * which compares reads-from only.
   */
  finalWrites: boolean;
}

function picksText(g: ViewGraph, open: Choice[], prefix: string): string {
  if (open.length === 0) return 'No open choices';
  return open.map((c, k) => `${prefix}${c.id}: ${arcText(c.options[g.picks[k]])}`).join(' · ');
}

/** The rules as the chosen semester states them, one per line. */
function RuleList({ style, finalWrites }: { style: ViewStyle; finalWrites: boolean }) {
  if (style === 'lecture') {
    return (
      <dl className="rule-list">
        <dt>Nodes:</dt>
        <dd>
          Every transaction, plus T0, which wrote the initial values
          {finalWrites ? ', and Tf, which reads every written object after the schedule ends.' : '.'}
        </dd>
        <dt>Edges:</dt>
        <dd>
          <ul className="flush">
            <li>
              If Ti reads X from Tj, add Tj → Ti
              {finalWrites ? ', so each final writer gets an arc to Tf.' : '.'}
            </li>
            <li>
              If Ti reads X from Tj and Tk also writes X, add Tk → Tj <em>or</em> Ti → Tk.
              <ul>
                <li>If Tj is T0, only Ti → Tk.</li>
                {finalWrites && <li>If Ti is Tf, only Tk → Tj.</li>}
              </ul>
            </li>
          </ul>
        </dd>
      </dl>
    );
  }
  return (
    <dl className="rule-list">
      <dt>Nodes:</dt>
      <dd>Every transaction, plus T0, which wrote the initial values.</dd>
      <dt>(a)</dt>
      <dd>If Tj reads O from Ti, add Ti → Tj.</dd>
      {finalWrites && (
        <>
          <dt>(b)</dt>
          <dd>If Ti makes the final write on O, add Tj → Ti for every other Tj updating O.</dd>
        </>
      )}
      <dt>(c)</dt>
      <dd>
        If Tj reads O from Tk and Ti updates O, add Ti → Tk <em>or</em> Tj → Ti.
        <ul>
          <li>If Tk is T0, Ti → T0 is impossible, so only Tj → Ti.</li>
        </ul>
      </dd>
    </dl>
  );
}

/**
 * The view-serializability graph in full: the rules, the edges every graph
 * has, the either/or choices, and every distinct graph those choices give.
 * Callers remount it (via `key`) when the schedule changes, which resets
 * the "only acyclic" and "show all" switches.
 */
export function ViewGraphPanel({ title, result: vss, style, onStyle, onHover, finalWrites }: Props) {
  const [onlyAcyclic, setOnlyAcyclic] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const look = VIEW_STYLES[style];
  const rules: EdgeRule[] =
    style === 'notes' && finalWrites ? ['a', 'b', 'c-forced', 'c'] : ['a', 'c-forced', 'c'];
  const labels = finalWrites
    ? look.labels
    : { ...look.labels, ...(style === 'lecture' ? { a: 'rules 1–2: reads from' } : {}) };

  const listed = vss.graphs.filter((g) => !onlyAcyclic || g.cycle === null);
  const shown = showAll ? listed : listed.slice(0, GRAPHS_SHOWN);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="section-head">{title}</h2>
        <div className="segmented" role="group" aria-label="Graph drawn as in">
          {(['lecture', 'notes'] as ViewStyle[]).map((s) => (
            <button
              key={s}
              className={s === style ? 'on' : ''}
              aria-pressed={s === style}
              title={VIEW_STYLES[s].method}
              onClick={() => {
                onStyle(s);
                setShowAll(false);
              }}
            >
              {VIEW_STYLES[s].label}
            </button>
          ))}
        </div>
      </div>
      <RuleList style={style} finalWrites={finalWrites} />
      <p className="note">
        Both drawings give the same verdict and serial orders; only the extra node and the rule
        labels differ.
      </p>
      <Legend rules={rules} labels={labels} />

      <h3 className="sub-head">Edges in every graph</h3>
      <EdgeRows edges={vss.base} onHover={onHover} />

      <h3 className="sub-head">
        {style === 'lecture' ? 'Rule 3' : 'Rule (c)'} choices — {vss.open.length} open,{' '}
        {vss.choices.length - vss.open.length} already satisfied
      </h3>
      {vss.choices.length === 0 ? (
        <p className="panel-text">
          None: no third transaction updates an object that was read from another.
        </p>
      ) : (
        <ul className="edge-rows">
          {vss.choices.map((c) => (
            <ChoiceRow key={c.id} choice={c} onHover={onHover} prefix={look.prefix} />
          ))}
        </ul>
      )}

      <div className="grid-head">
        <h3 className="sub-head">
          {vss.open.length === 0
            ? 'The graph'
            : `2^${vss.open.length} = ${vss.combinations} combinations → ${vss.graphs.length} distinct graph${vss.graphs.length === 1 ? '' : 's'}, ${vss.graphs.filter((g) => !g.cycle).length} acyclic`}
        </h3>
        {vss.graphs.length > 1 && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyAcyclic}
              onChange={(e) => setOnlyAcyclic(e.target.checked)}
            />
            only acyclic
          </label>
        )}
      </div>
      {vss.truncated && (
        <p className="note">
          Too many open choices to list them all: showing the first 2^10 combinations.
        </p>
      )}
      <div className={`graph-grid ${vss.graphs.length === 1 ? 'single' : ''}`}>
        {shown.map((g, i) => (
          <div key={i} className={`graph-card ${g.cycle ? 'cyclic' : 'acyclic'}`}>
            <GraphView
              nodes={vss.nodes}
              edges={g.graph.edges}
              cycle={g.cycle}
              onHover={onHover}
              compact={vss.graphs.length > 1}
              labels={labels}
            />
            <p className="graph-picks">{picksText(g, vss.open, look.prefix)}</p>
            <p className={`graph-verdict ${g.cycle ? 'no' : 'yes'}`}>
              {g.cycle
                ? `✗ cycle ${g.cycle.map(txnName).join(' → ')}`
                : `✓ acyclic: ${orderText(g.order!)}`}
            </p>
          </div>
        ))}
      </div>
      {listed.length > GRAPHS_SHOWN && (
        <button className="ghost show-all" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show fewer' : `Show all ${listed.length}`}
        </button>
      )}
    </section>
  );
}
