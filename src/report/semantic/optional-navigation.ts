import type { ReportRoute } from "../author/identity.ts";
import type {
  ReportBlock,
  ReportDocument,
  ReportScatter,
  ReportTreeTable,
} from "./document.ts";

/**
 * Resolves optional entity navigation against one execution's expanded routes.
 *
 * The caller must supply a validated, frozen document. Explicit inline links
 * remain untouched so the normal closed-document validator can reject them.
 */
export function resolveOptionalRouteTargets(
  document: ReportDocument,
  routes: ReadonlySet<ReportRoute>,
): ReportDocument {
  const children = resolveBlocks(document.children, routes);
  if (children === document.children) {
    return document;
  }
  return Object.freeze({ ...document, children });
}

function resolveBlocks(
  blocks: readonly ReportBlock[],
  routes: ReadonlySet<ReportRoute>,
): readonly ReportBlock[] {
  let changed = false;
  const resolved = blocks.map((block) => {
    const next = resolveBlock(block, routes);
    if (next !== block) changed = true;
    return next;
  });
  return changed ? Object.freeze(resolved) : blocks;
}

function resolveBlock(
  block: ReportBlock,
  routes: ReadonlySet<ReportRoute>,
): ReportBlock {
  switch (block.type) {
    case "section": {
      const children = resolveBlocks(block.children, routes);
      return children === block.children
        ? block
        : Object.freeze({ ...block, children });
    }
    case "list": {
      let changed = false;
      const items = block.items.map((item) => {
        const next = resolveBlocks(item, routes);
        if (next !== item) changed = true;
        return next;
      });
      return changed
        ? Object.freeze({ ...block, items: Object.freeze(items) })
        : block;
    }
    case "grid": {
      const cells = resolveBlocks(block.cells, routes);
      return cells === block.cells
        ? block
        : Object.freeze({ ...block, cells });
    }
    case "scatter":
      return resolveScatter(block, routes);
    case "tree-table":
      return resolveTreeTable(block, routes);
    case "paragraph":
    case "table":
    case "metric":
    case "status":
    case "code-block":
    case "chart":
    case "hero":
    case "summary":
    case "ranked-bars":
    case "stat":
    case "cell-table":
      return block;
  }
}

function resolveScatter(
  block: ReportScatter,
  routes: ReadonlySet<ReportRoute>,
): ReportScatter {
  let changed = false;
  const series = block.series.map((entry) => {
    let seriesChanged = false;
    const points = entry.points.map((point) => {
      if (point.target?.kind !== "route" || routes.has(point.target.route)) {
        return point;
      }
      changed = true;
      seriesChanged = true;
      return Object.freeze({
        key: point.key,
        x: point.x,
        y: point.y,
        xDisplay: point.xDisplay,
        yDisplay: point.yDisplay,
      });
    });
    return seriesChanged
      ? Object.freeze({ ...entry, points: Object.freeze(points) })
      : entry;
  });
  return changed
    ? Object.freeze({ ...block, series: Object.freeze(series) })
    : block;
}

function resolveTreeTable(
  block: ReportTreeTable,
  routes: ReadonlySet<ReportRoute>,
): ReportTreeTable {
  let changed = false;
  const rows = block.rows.map((row) => {
    if (row.target?.kind !== "route" || routes.has(row.target.route)) {
      return row;
    }
    changed = true;
    return Object.freeze({
      key: row.key,
      kind: row.kind,
      depth: row.depth,
      label: row.label,
      cells: row.cells,
    });
  });
  return changed
    ? Object.freeze({ ...block, rows: Object.freeze(rows) })
    : block;
}
