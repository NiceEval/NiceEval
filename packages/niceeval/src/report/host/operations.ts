import { Context, Data, Effect } from "effect";
import type { ReportDefinition } from "../definition/report.ts";
import type { ThemeDefinition } from "../theme.ts";

export class ReportPlatformError extends Data.TaggedError("ReportPlatformError")<{
  readonly operation: "load-config" | "load-report" | "load-theme" | "open-browser";
  readonly cause: unknown;
}> {}

export interface ReportModulePlatformService {
  readonly loadConfig: (cwd: string, options?: { readonly includeTheme?: boolean }) => Effect.Effect<{
    readonly report?: ReportDefinition;
    readonly theme?: ThemeDefinition;
    readonly watchInputs: readonly string[];
  }, ReportPlatformError>;
  readonly loadReport: (path: string) => Effect.Effect<{
    readonly report: ReportDefinition;
    readonly watchInputs: readonly string[];
  }, ReportPlatformError>;
  readonly loadTheme: (path: string) => Effect.Effect<{
    readonly theme: ThemeDefinition;
    readonly watchInputs: readonly string[];
  }, ReportPlatformError>;
  readonly resolveModulePath: (cwd: string, value: string) => string;
}

export class ReportModulePlatform extends Context.Tag("@niceeval/report/ReportModulePlatform")<
  ReportModulePlatform,
  ReportModulePlatformService
>() {}

export interface ReportBrowserService {
  readonly open: (url: string) => Effect.Effect<boolean, ReportPlatformError>;
}

export class ReportBrowser extends Context.Tag("@niceeval/report/ReportBrowser")<
  ReportBrowser,
  ReportBrowserService
>() {}
