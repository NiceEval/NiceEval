import { Effect } from "effect";

import { openViewServer } from "../../view/server.ts";
import type { ClosedSiteRevision } from "../execution/model.ts";
import { showReportFromRecord } from "./from-record.ts";
import { exportStaticReport } from "./static.ts";
import { openReportViewSession } from "./view-session.ts";
import type { OpenReportViewSessionInput } from "./view-session.ts";

function serve<Requirements>(
  input: OpenReportViewSessionInput<Requirements> & {
    readonly host: string;
    readonly port: number;
  },
) {
  return Effect.gen(function* () {
    const session = yield* openReportViewSession({
      url: input.url,
      watchInputs: input.watchInputs,
      initial: input.initial,
      rebuild: input.rebuild,
    });
    return yield* openViewServer({
      session,
      host: input.host,
      port: input.port,
    });
  });
}

/**
 * The complete public Report Host facade. `show` opens one fixed Sample and
 * executes one target. `serve` and `export` consume complete opaque revisions;
 * loaders, watchers, Record readers, and private Page values stay unexported.
 */
export const reportHost = Object.freeze({
  show: showReportFromRecord,
  serve,
  export: exportStaticReport,
});

export type { ClosedSiteRevision };
