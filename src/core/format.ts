import type { Edge } from './graph';
import { isVirtual, txnName } from './schedule';

/** "T2 → T1 → T3", leaving out T0 and Tf, which are never part of a serial order. */
export function orderText(order: number[]): string {
  return order.filter((t) => !isVirtual(t)).map(txnName).join(' → ');
}

/** "T1 → T2 → T1": the cycle as found, closing node included. */
export function cycleText(cycle: number[]): string {
  return cycle.map(txnName).join(' → ');
}

export function arcText(e: Edge): string {
  return `${txnName(e.from)} → ${txnName(e.to)}`;
}
