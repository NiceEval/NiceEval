export const DEFAULT_PR_BODY_BUDGET = 62 * 1024;
export const GITHUB_BODY_LIMIT = 65_536;

export type PrBodyCommand = "init" | "render" | "check" | "apply" | "create";

export interface InitPrBodyInput {
  readonly command: "init";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
  readonly base?: string | undefined;
}

export interface RenderPrBodyInput {
  readonly command: "render";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
  readonly out?: string | undefined;
}

export interface CheckPrBodyInput {
  readonly command: "check";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
  readonly budget?: number | undefined;
  /** GitHub comparison is deliberately opt-in; local checking is the default. */
  readonly remote?: boolean | undefined;
}

export interface ApplyPrBodyInput {
  readonly command: "apply";
  readonly pr: number;
  readonly source?: string | undefined;
  readonly budget?: number | undefined;
}

export interface CreatePrBodyInput {
  readonly command: "create";
  readonly source?: string | undefined;
  readonly title: string;
  readonly base?: string | undefined;
  readonly budget?: number | undefined;
}

export type PrBodyInput =
  | InitPrBodyInput
  | RenderPrBodyInput
  | CheckPrBodyInput
  | ApplyPrBodyInput
  | CreatePrBodyInput;

export interface DraftMetadata {
  readonly base: string;
  readonly templateSha256: string;
  readonly forbid?: readonly string[] | undefined;
}

export interface FinalMetadata extends DraftMetadata {
  readonly head: string;
}

export interface FragmentSpec {
  readonly from: string;
  readonly through: string;
}

export interface TestDirective {
  readonly path: string;
  readonly purpose: string;
  readonly protects: string;
  readonly runs: string;
  readonly asserts: string;
  readonly source?: "full" | {
    readonly fragments: readonly FragmentSpec[];
    readonly reason: string;
  } | undefined;
}

export interface RenderedBody {
  readonly body: string;
  readonly metadata: FinalMetadata;
  readonly referencedFiles: readonly string[];
  readonly source: string;
}

export interface ByteReportRow {
  readonly name: string;
  readonly bytes: number;
}

export interface ByteReport {
  readonly totalBytes: number;
  readonly rows: readonly ByteReportRow[];
  readonly text: string;
}

export type PrBodyOutcome =
  | Readonly<{ readonly _tag: "DraftCreated"; readonly path: string }>
  | Readonly<{ readonly _tag: "DraftInitialized"; readonly path: string }>
  | Readonly<{
      readonly _tag: "BodyRendered";
      readonly destination: "stdout" | string;
      readonly body: string;
      readonly bytes: number;
    }>
  | Readonly<{
      readonly _tag: "BodyChecked";
      readonly report: ByteReport;
      readonly remoteCompared: boolean;
    }>
  | Readonly<{
      readonly _tag: "BodyApplied";
      readonly pr: number;
      readonly source: string;
      readonly report: ByteReport;
    }>
  | Readonly<{
      readonly _tag: "PullRequestCreated";
      readonly pr: number;
      readonly url: string;
      readonly source: string;
      readonly report: ByteReport;
    }>;

export interface GitHubPullRequest {
  readonly body: string;
  readonly headRefOid: string;
}
