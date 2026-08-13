export function balanceColumns(cellCount: number, capacityColumns: number): number {
  const cells = Math.max(1, cellCount);
  const capacity = Math.max(1, Math.min(capacityColumns, cells));
  const rows = Math.ceil(cells / capacity);
  return Math.ceil(cells / rows);
}

export interface TextGridPlanInput {
  readonly availableWidth: number;
  readonly cellCount: number;
}

export interface TextGridPlan {
  readonly columns: number;
  readonly contentWidths: readonly number[];
  readonly fullRowContentWidth: number;
}

const MIN_CONTENT_WIDTH = 24;
export const TEXT_GRID_SEPARATOR = " │ ";

export function planTextGrid(input: TextGridPlanInput): TextGridPlan {
  const { availableWidth, cellCount } = input;
  const separator = TEXT_GRID_SEPARATOR.length;
  const cells = Math.max(1, cellCount);

  let capacity = 1;
  for (let n = cells; n >= 2; n--) {
    const budget = availableWidth - separator * (n - 1);
    if (budget >= 0 && Math.floor(budget / n) >= MIN_CONTENT_WIDTH) {
      capacity = n;
      break;
    }
  }

  const chosen = balanceColumns(cells, capacity);
  const budget = Math.max(0, availableWidth - separator * (chosen - 1));
  const base = Math.floor(budget / chosen);
  const remainder = budget - base * chosen;
  const contentWidths = Array.from({ length: chosen }, (_, i) => Math.max(1, base + (i < remainder ? 1 : 0)));

  return { columns: chosen, contentWidths, fullRowContentWidth: Math.max(1, availableWidth) };
}
