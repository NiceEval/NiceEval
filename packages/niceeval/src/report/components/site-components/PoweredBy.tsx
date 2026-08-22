import type { ReactElement } from "react";

/** The fixed, public destination for Report attribution. */
export const POWERED_BY_HREF = "https://niceeval.com/?utm_source=report&utm_medium=powered-by";

/** A visual Report attribution.  The Report primitive supplies its text face. */
export function PoweredBy(): ReactElement {
  return (
    <p className="niceeval-report niceeval-powered-by">
      <a href={POWERED_BY_HREF} target="_blank" rel="noopener">
        Powered by NiceEval
      </a>
    </p>
  );
}
