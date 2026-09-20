export const DEFAULT_PR_BODY_BUDGET = 62 * 1024;
export const GITHUB_BODY_LIMIT = 65_536;

export type PrBodyCommand = "init" | "status" | "discard" | "edit" | "render" | "check" | "apply" | "create";

export const PR_BODY_MUTATION_ACTIONS = ["apply", "create"] as const;
export type PrBodyMutationAction = typeof PR_BODY_MUTATION_ACTIONS[number];

export const PR_BODY_DRAFT_STATES = ["missing", "managed", "unmanaged"] as const;
export type PrBodyDraftState = typeof PR_BODY_DRAFT_STATES[number];

export const PR_BODY_CASE_SECTIONS = [
  "public-api",
  "cli",
  "report-components",
  "observable-behavior",
  "package-scripts",
] as const;
export type PrBodyCaseSection = typeof PR_BODY_CASE_SECTIONS[number];

export const PR_BODY_CASE_DIRECTIONS = ["removed", "added", "changed"] as const;
export type PrBodyCaseDirection = typeof PR_BODY_CASE_DIRECTIONS[number];

export const PR_BODY_TERMINOLOGY_DIRECTIONS = ["added", "removed"] as const;
export type PrBodyTerminologyDirection = typeof PR_BODY_TERMINOLOGY_DIRECTIONS[number];

const DOTTED_NUMERIC_VERSION = /^\d+(?:\.\d+)*$/;
const TERMINOLOGY_CANONICAL_PREFIX = "docs/concepts.md#";
const UNICODE_MARKDOWN_ANCHOR = /^[\p{L}\p{M}\p{N}_-]+$/u;

export function isPrBodyRecordVersion(value: string): boolean {
  const [before, after, extra] = value.split(" -> ");
  return extra === undefined
    && before !== undefined
    && after !== undefined
    && DOTTED_NUMERIC_VERSION.test(before)
    && DOTTED_NUMERIC_VERSION.test(after);
}

export function isPrBodyTerminologyCanonical(value: string): boolean {
  if (!value.startsWith(TERMINOLOGY_CANONICAL_PREFIX)) return false;
  return UNICODE_MARKDOWN_ANCHOR.test(value.slice(TERMINOLOGY_CANONICAL_PREFIX.length));
}

interface EditLocationInput {
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
}

export interface EditResetInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "reset";
}

export interface EditProblemInput extends EditLocationInput, PrBodyProblem {
  readonly command: "edit";
  readonly operation: "problem";
}

export interface EditClosingIssueAddInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "closing-issue-add";
  readonly issue: number;
}

export interface EditClosingIssueRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "closing-issue-remove";
  readonly issue: number;
}

export interface EditCaseSetInput extends EditLocationInput, PrBodyCase {
  readonly command: "edit";
  readonly operation: "case-set";
}

export interface EditCaseRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "case-remove";
  readonly section: PrBodyCaseSection;
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
}

export interface EditUseCaseSetInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "use-case-set";
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
  readonly contract: string;
  readonly startingState: string;
  readonly action: string;
  readonly result: string;
  readonly explanation: string;
  readonly language?: string | undefined;
}

export interface EditUseCaseRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "use-case-remove";
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
}

export interface EditRecordNewWriteSetInput extends EditLocationInput, PrBodyRecordActionResult {
  readonly command: "edit";
  readonly operation: "record-new-write-set";
}

export interface EditRecordNewWriteRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "record-new-write-remove";
}

export interface EditRecordExistingReadSetInput extends EditLocationInput, PrBodyRecordActionResult {
  readonly command: "edit";
  readonly operation: "record-existing-read-set";
}

export interface EditRecordExistingReadRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "record-existing-read-remove";
}

export interface EditRecordUpgradeSetInput extends EditLocationInput, PrBodyRecordUpgrade {
  readonly command: "edit";
  readonly operation: "record-upgrade-set";
}

export interface EditRecordUpgradeRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "record-upgrade-remove";
}

export interface EditRecordPrivateSetInput extends EditLocationInput, PrBodyPrivatePersistedCase {
  readonly command: "edit";
  readonly operation: "record-private-set";
}

export interface EditRecordPrivateRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "record-private-remove";
  readonly name: string;
}

export interface EditEnvironmentSetInput extends EditLocationInput, PrBodyEnvironmentCase {
  readonly command: "edit";
  readonly operation: "environment-set";
}

export interface EditEnvironmentRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "environment-remove";
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
}

export interface EditTerminologySetInput extends EditLocationInput, PrBodyTerminologyCase {
  readonly command: "edit";
  readonly operation: "terminology-set";
}

export interface EditTerminologyRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "terminology-remove";
  readonly direction: PrBodyTerminologyDirection;
  readonly name: string;
}

export interface EditTestSetInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "test-set";
  readonly selector: string;
  readonly behavior: string;
  readonly entry: string;
  readonly assertion: string;
  readonly escape: string;
  readonly regression?: string | undefined;
  readonly fragmentFrom: readonly string[];
  readonly fragmentThrough: readonly string[];
  readonly fragmentReason?: string | undefined;
  readonly sourceMode?: "full" | "link" | undefined;
}

export interface EditTestRemoveInput extends EditLocationInput {
  readonly command: "edit";
  readonly operation: "test-remove";
  readonly selector: string;
}

export interface PrBodyVerification {
  readonly candidate: string;
  readonly red?: string | undefined;
  readonly green: string;
  readonly repeatability: string;
  readonly fixedConditions: string;
  readonly unitCount: string;
}

export interface EditVerificationInput extends EditLocationInput, PrBodyVerification {
  readonly command: "edit";
  readonly operation: "verification";
}

export type EditPrBodyInput =
  | EditResetInput
  | EditProblemInput
  | EditClosingIssueAddInput
  | EditClosingIssueRemoveInput
  | EditCaseSetInput
  | EditCaseRemoveInput
  | EditUseCaseSetInput
  | EditUseCaseRemoveInput
  | EditRecordNewWriteSetInput
  | EditRecordNewWriteRemoveInput
  | EditRecordExistingReadSetInput
  | EditRecordExistingReadRemoveInput
  | EditRecordUpgradeSetInput
  | EditRecordUpgradeRemoveInput
  | EditRecordPrivateSetInput
  | EditRecordPrivateRemoveInput
  | EditEnvironmentSetInput
  | EditEnvironmentRemoveInput
  | EditTerminologySetInput
  | EditTerminologyRemoveInput
  | EditTestSetInput
  | EditTestRemoveInput
  | EditVerificationInput;

export interface InitPrBodyInput {
  readonly command: "init";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
  readonly base?: string | undefined;
}

export interface StatusPrBodyInput {
  readonly command: "status";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
}

export interface DiscardPrBodyInput {
  readonly command: "discard";
  readonly pr?: number | undefined;
  readonly source?: string | undefined;
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
  /** GitHub comparison is deliberately opt-in; local checking is the default. */
  readonly remote?: boolean | undefined;
}

export interface ApplyPrBodyInput {
  readonly command: "apply";
  readonly pr: number;
  readonly source?: string | undefined;
}

export interface CreatePrBodyInput {
  readonly command: "create";
  readonly source?: string | undefined;
  readonly title: string;
  readonly base?: string | undefined;
}

export type PrBodyInput =
  | InitPrBodyInput
  | StatusPrBodyInput
  | DiscardPrBodyInput
  | EditPrBodyInput
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
  readonly cases: readonly PrBodyTestCase[];
  readonly source?: "full" | "link" | {
    readonly fragments: readonly FragmentSpec[];
    readonly reason: string;
  } | undefined;
}

export interface PrBodyTestCase {
  readonly selector: string;
  readonly behavior: string;
  readonly entry: string;
  readonly assertion: string;
  readonly escape: string;
  readonly regression?: string | undefined;
}

export interface PrBodyUseCase {
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
  readonly contract: string;
  readonly startingState: string;
  readonly action: string;
  readonly result: string;
  readonly explanation: string;
  readonly language?: string | undefined;
}

export interface PrBodyProblem {
  readonly userGoal: string;
  readonly currentLimitation: string;
  readonly requiredCapability: string;
  readonly userOutcome: string;
}

export interface PrBodyCase {
  readonly section: PrBodyCaseSection;
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
  readonly beforeInput: string;
  readonly beforeOutput: string;
  readonly afterInput?: string | undefined;
  readonly afterOutput: string;
  readonly userImpact: string;
  readonly language?: string | undefined;
}

export interface PrBodyRecordActionResult {
  readonly action: string;
  readonly result: string;
}

export interface PrBodyRecordUpgrade {
  readonly version: string;
  readonly beforeInput: string;
  readonly beforeOutput: string;
  readonly afterInput: string;
  readonly afterOutput: string;
  readonly safety: string;
  readonly userImpact: string;
  readonly evidence: string;
}

export interface PrBodyPrivatePersistedCase {
  readonly name: string;
  readonly before: string;
  readonly after: string;
  readonly userImpact: string;
}

export interface PrBodyRecordSection {
  readonly newWrite?: PrBodyRecordActionResult | undefined;
  readonly existingRead?: PrBodyRecordActionResult | undefined;
  readonly upgrade?: PrBodyRecordUpgrade | undefined;
  readonly privatePersisted?: readonly PrBodyPrivatePersistedCase[] | undefined;
}

export interface PrBodyEnvironmentCase {
  readonly direction: PrBodyCaseDirection;
  readonly name: string;
  readonly beforeInput: string;
  readonly beforeOutput: string;
  readonly afterInput?: string | undefined;
  readonly afterOutput?: string | undefined;
  readonly boundary: string;
  readonly necessity?: string | undefined;
  readonly securityImpact: string;
}

export interface PrBodyTerminologyCase {
  readonly direction: PrBodyTerminologyDirection;
  readonly name: string;
  readonly before: string;
  readonly after: string;
  readonly explanation: string;
  readonly canonical: string;
}

export interface PrBodyEditorState {
  readonly version: 2;
  readonly problem?: PrBodyProblem | undefined;
  readonly closingIssues?: readonly number[] | undefined;
  readonly cases: readonly PrBodyCase[];
  readonly useCases: readonly PrBodyUseCase[];
  readonly record?: PrBodyRecordSection | undefined;
  readonly environment?: readonly PrBodyEnvironmentCase[] | undefined;
  readonly terminology?: readonly PrBodyTerminologyCase[] | undefined;
  readonly tests: readonly TestDirective[];
  readonly verification?: PrBodyVerification | undefined;
}

export interface RenderedBody {
  readonly body: string;
  readonly metadata: FinalMetadata;
  readonly referencedFiles: readonly string[];
  readonly inputFiles: readonly string[];
  /** The remote repository encoded into source=link output, if used. */
  readonly linkRepository?: string | undefined;
  readonly targetRepository?: string | undefined;
  readonly draftSha256: string;
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
  | Readonly<{ readonly _tag: "DraftStatus"; readonly path: string; readonly state: PrBodyDraftState }>
  | Readonly<{ readonly _tag: "DraftDiscarded"; readonly path: string }>
  | Readonly<{
      readonly _tag: "DraftEdited";
      readonly path: string;
      readonly operation: EditPrBodyInput["operation"];
      readonly sections: number;
      readonly cases: number;
      readonly tests: number;
    }>
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
  readonly headRepository: string;
  readonly baseRefOid: string;
  readonly baseRefName: string;
  /** Parsed from GitHub's supported pull-request URL field. */
  readonly baseRepository: string;
}
