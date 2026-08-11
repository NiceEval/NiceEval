// `show` is a thin terminal facade over the Effect-native Report host. The
// actual RecordReader -> AnalysisSampleHandle -> executeReport composition is
// deliberately owned by the CLI/application boundary, never by this module.

import type { ReportExecution } from "../report/execution/model.ts";
import { reportRoute } from "../report/author/identity.ts";
import { Either } from "effect";
import {
  ReportConsole,
  renderReportExecutionJson,
  renderReportExecutionText,
  showReport,
  type ReportConsoleError,
  type ReportConsoleService,
  type ReportShowError,
  type ShowReportInput,
} from "../report/host/presentation.ts";

export {
  ReportConsole,
  renderReportExecutionJson,
  renderReportExecutionText,
  showReport,
};
export type {
  ReportConsoleError,
  ReportConsoleService,
  ReportShowError,
  ShowReportInput,
};

/**
 * Kept only until the CLI switches its argument parsing to the current
 * RecordReader/AnalysisSampleHandle pipeline. The compatibility facade cannot
 * reinterpret the removed Record/Fact graph; callers that already have an
 * execution may supply it directly.
 */
export interface ShowFlags {
  readonly source?: boolean | string;
  readonly execution?: boolean;
  readonly timing?: "summary" | "full";
  readonly diff?: boolean;
  readonly diffPath?: string;
  readonly grep?: string;
  readonly expand?: string;
  readonly history?: boolean;
  readonly usage?: boolean;
  readonly stats?: boolean;
  readonly experiment?: readonly string[];
  readonly record?: string;
  readonly report?: string;
  readonly configReport?: unknown;
  readonly page?: string;
  readonly json?: boolean;
  readonly projectTarget?: unknown;
  /** A CLI/application boundary may hand the completed execution directly in. */
  readonly reportExecution?: ReportExecution;
}

export interface ShowIO {
  readonly out?: (text: string) => void;
  readonly err?: (text: string) => void;
}

/**
 * Legacy CLI-shaped shim. It performs no Record I/O and no Effect execution;
 * when an application has already composed an immutable execution it writes
 * that exact value once. This keeps old entry wiring from reviving retired
 * runtime objects while the CLI migration lands separately.
 */
export async function runShow(
  _cwd: string,
  _patterns: readonly string[],
  flags: ShowFlags,
  io: ShowIO = {},
): Promise<number> {
  const out = io.out ?? ((text: string) => process.stdout.write(text));
  const err = io.err ?? ((text: string) => process.stderr.write(text));
  const execution = flags.reportExecution;
  if (execution === undefined) {
    err("niceeval show needs the current Report execution pipeline; the retired Record runtime is not available.\n");
    return 1;
  }
  try {
    const route = flags.page === undefined ? undefined : reportRoute(flags.page);
    if (route !== undefined && Either.isLeft(route)) {
      err("niceeval show received an invalid Report route.\n");
      return 1;
    }
    const page = route === undefined ? undefined : route.right;
    if (flags.json) {
      err("niceeval show --json is rendered by the Effect-native Report host; this retired CLI shim cannot start a private runtime.\n");
      return 1;
    }
    out(renderReportExecutionText({ execution, ...(page === undefined ? {} : { page }) }));
    return 0;
  } catch {
    err("niceeval show could not render the fixed Report execution.\n");
    return 1;
  }
}
