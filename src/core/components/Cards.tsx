import type { ReactNode } from 'react';
import { arcText } from '../format';
import type { Edge } from '../graph';
import type { Choice } from '../polygraph';
import type { Verdict } from '../verdict';

type OnHover = (ops: number[] | null) => void;

interface CardProps {
  name: string;
  rule: string;
  verdict: Verdict;
  onHover: OnHover;
  /** The nearest stronger property that holds, which already guarantees this one. */
  impliedBy?: string;
  children?: ReactNode;
}

/** One property: verdict badge, the rule, a one-line summary, and hoverable violations. */
export function PropertyCard({ name, rule, verdict, onHover, impliedBy, children }: CardProps) {
  return (
    <div className={`card ${verdict.holds ? 'yes' : 'no'}`}>
      <div className="card-head">
        <span className="card-name">{name}</span>
        <span className="badge">{verdict.holds ? '✓ yes' : '✗ no'}</span>
      </div>
      <p className="card-rule">{rule}</p>
      <p className="card-summary">{verdict.summary}</p>
      {verdict.violations.length > 0 && (
        <ul className="violations">
          {verdict.violations.map((v, i) => (
            <li key={i} onMouseEnter={() => onHover(v.ops)} onMouseLeave={() => onHover(null)}>
              {v.text}
            </li>
          ))}
        </ul>
      )}
      {impliedBy && (
        <p className="card-implied">Already guaranteed: every {impliedBy} schedule is one.</p>
      )}
      {children}
    </div>
  );
}

/** The ⊂ between two cards: everything on its left is also on its right. */
export function Subset({ title }: { title: string }) {
  return (
    <div className="subset" title={title} aria-label={title}>
      <span className="subset-sym">⊂</span>
      <span className="subset-text">subset of</span>
    </div>
  );
}

/** Edges with their reasons; hovering a row lights its operations. */
export function EdgeRows({ edges, onHover }: { edges: Edge[]; onHover: OnHover }) {
  return (
    <ul className="edge-rows">
      {edges.map((e, i) => (
        <li key={i} onMouseEnter={() => onHover(e.ops)} onMouseLeave={() => onHover(null)}>
          <span className={`arc rule-text rule-${e.rule}`}>{arcText(e)}</span>
          <span>{e.reasons.join('; ')}</span>
        </li>
      ))}
    </ul>
  );
}

/** One either/or choice, and whether an existing edge already settles it. */
export function ChoiceRow({
  choice,
  onHover,
  prefix,
}: {
  choice: Choice;
  onHover: OnHover;
  /** Shown before the choice number: "c" for rule (c), "#" for the lecture's rule 3. */
  prefix: string;
}) {
  const [x, y] = choice.options;
  return (
    <li onMouseEnter={() => onHover(x.ops)} onMouseLeave={() => onHover(null)}>
      <span className="arc">
        {prefix}
        {choice.id}: <span className="rule-text rule-c">{arcText(x)}</span> or{' '}
        <span className="rule-text rule-c">{arcText(y)}</span>
      </span>
      <span>
        {x.reasons.join('; ')}.{' '}
        {choice.satisfiedBy !== null ? (
          <em>
            Already satisfied: {arcText(choice.options[choice.satisfiedBy])} is in the graph, so
            this choice adds nothing.
          </em>
        ) : (
          <em>Open: each option gives a different graph.</em>
        )}
      </span>
    </li>
  );
}
