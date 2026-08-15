import { REPORT_DOCUMENT_DEPTH_MAX } from "niceeval/report";

/** Distinctive CopyBlock body owned by the report-show owner. */
export const SHOW_COPY_BLOCK_TEXT = "niceeval show copy-block visible text";

/** Status rendered after the deep hierarchy so show finishing past that table is visible. */
export const SHOW_HIERARCHY_RENDERED = "deep-hierarchy-rendered";

/**
 * Deepest legal cell-table parent chain. Closed validation rejects more than
 * `REPORT_DOCUMENT_DEPTH_MAX` hops; the renderer still walks this iteratively.
 */
export const SHOW_HIERARCHY_CHAIN = REPORT_DOCUMENT_DEPTH_MAX;
