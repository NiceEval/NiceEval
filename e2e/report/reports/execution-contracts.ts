import { Either } from "effect";
import {
  definePage,
  definePageFamily,
  defineReport,
  reportComponentId,
  reportDocument,
  reportId,
  reportInstanceKey,
  reportRoute,
  type ReportBlock,
  type ReportDocument,
} from "niceeval/report";

type CellShape = "exact" | "missing" | "extra";

// Public Report contract: a document permits at most 32 hierarchy hops.
// Keep this fixture independent of the production validator implementation.
const MAXIMUM_LEGAL_HIERARCHY_DEPTH = 32;

const scenario = process.env.NICEEVAL_REPORT_EXECUTION_CONTRACT;
const columns = ["Name", "State"] as const;

export default scenario === "navigation"
  ? navigationReport()
  : scenario === "page-selection"
  ? pageSelectionReport()
  : lowLevelReport();

function lowLevelReport() {
  if (scenario === "deep") {
    return defineReport({
      id: reportIdValue("execution-contracts-deep"),
      pages: [
        lowLevelPage("zulu", "/zulu", emptyDocument("Zulu")),
        lowLevelPage("root", "/", reportDocument({ title: "Deep hierarchy", children: [deepHierarchyTable()] })),
        lowLevelPage("alpha", "/alpha", emptyDocument("Alpha")),
      ],
    });
  }
  if (scenario === "closure") {
    return defineReport({
      id: reportIdValue("execution-contracts-closure"),
      pages: [
        lowLevelPage("zulu", "/zulu", emptyDocument("Zulu")),
        lowLevelPage("root", "/", validDocument()),
        lowLevelPage("normal-missing", "/normal-missing", normalDocument("missing")),
        lowLevelPage("normal-extra", "/normal-extra", normalDocument("extra")),
        lowLevelPage("hierarchy-missing", "/hierarchy-missing", hierarchyDocument("missing")),
        lowLevelPage("hierarchy-extra", "/hierarchy-extra", hierarchyDocument("extra")),
        lowLevelPage("alpha", "/alpha", emptyDocument("Alpha")),
      ],
    });
  }
  return defineReport({
    id: reportIdValue("execution-contracts-valid"),
    pages: [
      lowLevelPage("zulu", "/zulu", emptyDocument("Zulu")),
      lowLevelPage("root", "/", validDocument()),
      lowLevelPage("alpha", "/alpha", emptyDocument("Alpha")),
    ],
  });
}

function navigationReport() {
  return defineReport({
    title: "Execution navigation",
    pages: [
      { id: "zulu", title: "Zebra first", render: () => "zulu public route body" },
      { id: "zebra", title: "Zebra second", render: () => "zebra public route body" },
      { id: "alpha", title: "Alpha last", render: () => "alpha public route body" },
    ],
  });
}

function pageSelectionReport() {
  return defineReport({
    id: reportIdValue("execution-contracts-page-selection"),
    pages: [
      lowLevelPage("root", "/", emptyDocument("Page selection root")),
      repeatedFamily("attempt"),
      repeatedFamily("experiment"),
    ],
  });
}

function repeatedFamily(id: "attempt" | "experiment") {
  return definePageFamily({
    id: componentIdValue(id),
    instances: () => ["first", "second"],
    key: (instance) => instanceKeyValue(`${id}-${instance}`),
    route: (instance) => reportRouteValue(`/${id}/${instance}`),
    render: ({ instance }) => emptyDocument(`${id} ${instance} exact route`),
  });
}

function lowLevelPage(id: string, route: string, document: ReportDocument) {
  return definePage({
    id: componentIdValue(id),
    route: reportRouteValue(route),
    render: () => document,
  });
}

function validDocument(): ReportDocument {
  return reportDocument({
    title: "Exact cell-table closure",
    children: [normalTable("exact"), hierarchyTable("exact"), hierarchyAtDepthLimitTable()],
  });
}

function normalDocument(shape: Exclude<CellShape, "exact">): ReportDocument {
  return reportDocument({
    title: `Normal ${shape}`,
    children: [normalTable(shape)],
  });
}

function hierarchyDocument(shape: Exclude<CellShape, "exact">): ReportDocument {
  return reportDocument({
    title: `Hierarchy ${shape}`,
    children: [hierarchyTable(shape)],
  });
}

function emptyDocument(title: string): ReportDocument {
  return reportDocument({ title, children: [] });
}

function normalTable(shape: CellShape): ReportBlock {
  return {
    type: "cell-table",
    columns,
    rows: [{ key: "normal", cells: cellsFor(shape) }],
  };
}

function hierarchyTable(shape: CellShape): ReportBlock {
  return {
    type: "cell-table",
    columns,
    hierarchy: true,
    rows: [
      { key: "root", kind: "experiment", label: "Root", cells: cellsFor("exact") },
      {
        key: "group",
        kind: "group",
        label: "Group",
        parentKey: "root",
        cells: cellsFor(shape),
      },
    ],
  };
}

function deepHierarchyTable(): ReportBlock {
  const rows: Extract<ReportBlock, { readonly type: "cell-table" }>['rows'][number][] = [{
    key: "root",
    kind: "experiment",
    label: "Root",
    cells: cellsFor("exact"),
  }];
  for (let index = 1; index <= MAXIMUM_LEGAL_HIERARCHY_DEPTH + 1; index += 1) {
    rows.push({
      key: `group-${index}`,
      kind: "group",
      label: `Group ${index}`,
      parentKey: index === 1 ? "root" : `group-${index - 1}`,
      cells: cellsFor("exact"),
    });
  }
  return { type: "cell-table", columns, hierarchy: true, rows };
}

function hierarchyAtDepthLimitTable(): ReportBlock {
  const rows: Extract<ReportBlock, { readonly type: "cell-table" }>['rows'][number][] = [{
    key: "root",
    kind: "experiment",
    label: "Root",
    cells: cellsFor("exact"),
  }];
  for (let index = 1; index <= MAXIMUM_LEGAL_HIERARCHY_DEPTH; index += 1) {
    rows.push({
      key: `group-${index}`,
      kind: "group",
      label: `Group ${index}`,
      parentKey: index === 1 ? "root" : `group-${index - 1}`,
      cells: cellsFor("exact"),
    });
  }
  return { type: "cell-table", columns, hierarchy: true, rows };
}

function cellsFor(shape: CellShape): Readonly<Record<string, string>> {
  switch (shape) {
    case "exact":
      return { Name: "cell-table", State: "complete" };
    case "missing":
      return { Name: "cell-table" };
    case "extra":
      return { Name: "cell-table", State: "complete", Extra: "unexpected" };
  }
}

function componentIdValue(value: string) {
  return Either.getOrThrow(reportComponentId(value));
}

function reportIdValue(value: string) {
  return Either.getOrThrow(reportId(value));
}

function reportRouteValue(value: string) {
  return Either.getOrThrow(reportRoute(value));
}

function instanceKeyValue(value: string) {
  return Either.getOrThrow(reportInstanceKey(value));
}
