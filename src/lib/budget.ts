// The one place the green / amber / red rule lives. Used by the live budget
// line while typing and by the server when it answers a save.

export type BudgetState = "green" | "amber" | "red";

export type BudgetNumbers = {
  effectiveAllocation: number;
  remaining: number;
  alertPct: number;
};

export function alertThreshold(effectiveAllocation: number, alertPct: number): number {
  return Math.floor((Math.max(effectiveAllocation, 0) * alertPct) / 100);
}

export function budgetState(effectiveAllocation: number, remainingAfter: number, alertPct: number): BudgetState {
  if (remainingAfter < 0) return "red";
  if (remainingAfter <= alertThreshold(effectiveAllocation, alertPct)) return "amber";
  return "green";
}

/** State after entering `amount` against a category's current numbers. */
export function stateAfter(b: BudgetNumbers, amount: number) {
  const remainingAfter = b.remaining - amount;
  const pctLeft = b.effectiveAllocation > 0 ? (remainingAfter / b.effectiveAllocation) * 100 : 0;
  return {
    remainingAfter,
    pctLeft,
    state: budgetState(b.effectiveAllocation, remainingAfter, b.alertPct),
  };
}
