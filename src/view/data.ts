import type { ClosedSiteRevision } from "../report/execution/model.ts";

/**
 * A View host receives a byte-complete immutable SiteRevision. It does not
 * discover historical evaluation data or render from an execution at request
 * time.
 */
export interface ViewScanOptions {
  readonly revision?: ClosedSiteRevision;
}
