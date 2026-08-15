/** A row identity used only to walk cell-table parent/child topology. */
export interface CellTableHierarchyRow {
  readonly key: string;
  readonly parentKey?: string;
}

/**
 * Iterative parent-chain depths. A recursive walk of a legal but deep
 * hierarchy would overflow the JS stack before closed validation can reject it.
 */
export function cellTableHierarchyDepths(
  rows: readonly CellTableHierarchyRow[],
): ReadonlyMap<string, number> {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const depths = new Map<string, number>();
  for (const row of rows) {
    if (depths.has(row.key)) continue;
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = row.key;
    while (current !== undefined && !depths.has(current)) {
      if (seen.has(current)) {
        throw unsupportedHierarchy("cycle");
      }
      seen.add(current);
      chain.push(current);
      const parent = byKey.get(current);
      current = parent?.parentKey;
    }
    let depth = current === undefined ? 0 : depths.get(current)! + 1;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      depths.set(chain[index]!, depth);
      depth += 1;
    }
  }
  return depths;
}

/** Children grouped in author/declaration order, including root rows (`parentKey` absent). */
export function cellTableHierarchyChildren<Row extends CellTableHierarchyRow>(
  rows: readonly Row[],
): ReadonlyMap<string | undefined, readonly Row[]> {
  const children = new Map<string | undefined, Row[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentKey);
    if (siblings === undefined) {
      children.set(row.parentKey, [row]);
      continue;
    }
    siblings.push(row);
  }
  return children;
}

/**
 * Parent-after-children order from the root rows. The walk is iterative so a
 * deep legal parent chain cannot throw `RangeError` during render.
 */
export function cellTableHierarchyPostOrder<Row extends CellTableHierarchyRow>(
  rows: readonly Row[],
): readonly Row[] {
  const children = cellTableHierarchyChildren(rows);
  const order: Row[] = [];
  const stack: Array<{ readonly row: Row; readonly visiting: boolean }> = [];
  const seen = new Set<string>();
  const roots = children.get(undefined) ?? [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    stack.push({ row: roots[index]!, visiting: false });
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!frame.visiting) {
      if (seen.has(frame.row.key)) {
        throw unsupportedHierarchy("cycle");
      }
      seen.add(frame.row.key);
      const descendants = children.get(frame.row.key) ?? [];
      stack.push({ row: frame.row, visiting: true });
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        stack.push({ row: descendants[index]!, visiting: false });
      }
      continue;
    }
    order.push(frame.row);
  }
  return Object.freeze(order);
}

export function unsupportedReportBlock(type: unknown): never {
  throw Object.assign(
    new Error(`unsupported report block: ${typeof type === "string" ? type : "unknown"}`),
    { code: "unsupported" as const },
  );
}

export function unsupportedReportInline(type: unknown): never {
  throw Object.assign(
    new Error(`unsupported report inline: ${typeof type === "string" ? type : "unknown"}`),
    { code: "unsupported" as const },
  );
}

function unsupportedHierarchy(reason: "cycle"): never {
  throw Object.assign(
    new Error(`unsupported cell-table hierarchy ${reason}`),
    { code: "unsupported" as const },
  );
}
