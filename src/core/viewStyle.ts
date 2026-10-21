import { useState } from 'react';
import type { EdgeRule } from './graph';
import type { ViewStyle } from './polygraph';

/** Wording for each drawing style; the verdicts are the same either way. */
export const VIEW_STYLES: Record<
  ViewStyle,
  {
    label: string;
    /** What the semester's material used, shown on hover. */
    method: string;
    /** Shown before a choice's number: "#1" for rule 3, "c1" for rule (c). */
    prefix: string;
    labels: Partial<Record<EdgeRule, string>>;
  }
> = {
  lecture: {
    label: 'AY26/27 Sem 1',
    method: 'T0 + Tf nodes, reads-from arcs, rule 3 with special cases',
    prefix: '#',
    labels: {
      a: 'rules 1–2: reads from (Tf reads final values)',
      'c-forced': 'rule 3, special case (forced)',
      c: 'rule 3, chosen',
    },
  },
  notes: {
    label: 'AY25/26 Sem 2',
    method: 'T0 only, rules (a), (b), (c)',
    prefix: 'c',
    labels: {},
  },
};

const STYLE_KEY = 'vss-style';

function savedStyle(): ViewStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'notes' ? 'notes' : 'lecture';
  } catch {
    return 'lecture';
  }
}

/** The drawing style, shared by every page and remembered in this browser. */
export function useViewStyle(): [ViewStyle, (next: ViewStyle) => void] {
  const [style, setStyle] = useState<ViewStyle>(savedStyle);
  function choose(next: ViewStyle) {
    setStyle(next);
    try {
      localStorage.setItem(STYLE_KEY, next);
    } catch {
      // Remembering the choice is a convenience; without storage it just resets.
    }
  }
  return [style, choose];
}
