// @concord-file
// @concord-implements docs/feature/inspection/cli.md
import { InspectionSourceError } from "../inspection/source.ts";
import { SqliteRecordError } from "../record/sqlite/errors.ts";
import { inspectionByteOffset } from "../inspection/continuation.ts";
import { inspectionShellWord } from "../inspection/addressing.ts";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { InspectionRepricingInputSchema } from "../inspection/repricing.ts";
import { ArtifactIdSchema } from "../record/codec/identifiers.ts";
import { decodeAgentJudgeTrace, type AgentJudgeTrace } from "../assertions/agent-judge-audit.ts";
import { decodeBase64Bytes, InspectionSha256 } from "../inspection/bytes.ts";
import { Effect, Result, Schema } from "effect";

import { CliArguments, CliInvocationFacts, CliOutput, type CliOptionDefinition } from "../cli/application.ts";
import { CliFeatureError, type CliCommandContribution } from "../cli/contribution.ts";
import {
  InspectionIntegrityError,
  InspectionOperationError,
  externalInspectionSource,
  openInspectionSource,
  operationalInspectionSource,
  selectInspectionOperation,
  type InspectionFactSource,
  type InspectionOperationFor,
  type InspectionSuccessDocumentFor,
} from "../inspection/index.ts";
import { ExperimentIdSchema, RunIdSchema } from "../record/codec/identifiers.ts";
import { parseAttemptLocator } from "../attempt-locator.ts";
import { ProjectConfiguration } from "../cli/project-configuration.ts";
import { CurrentTargetUnavailable } from "../experiment/host/current.ts";
import { openCurrentProjectSource } from "../inspection/project-source.ts";
import {
  renderComparison,
  comparisonRegressions,
  renderAttempt,
  renderAssertions,
  renderAssertionMatrix,
  renderReferences,
  renderDiff,
  renderExperiment,
  renderOverview,
  renderRun,
  renderSources,
  renderTiming,
  renderTrace,
  renderTraceDetail,
  renderUsage,
} from "./render.ts";
import {
  projectAttempt,
  projectDiff,
  projectExperiment,
  projectOverview,
  projectRun,
  projectSources,
  projectTiming,
  projectTrace,
  projectTraceDetail,
  projectUsage,
} from "./model.ts";

import { AssertionEntryIdSchema } from "../assertions/record/codec.ts";
import { canonicalInspectionJson } from "../inspection/canonical.ts";
import { INSPECTION_FAILURE_EXIT_CODE, inspectionFailureDocument } from "../inspection/cli/failure.ts";
import { explainInspectionOperation } from "../inspection/select.ts";
import { inspectionTraceSelector, parseInspectionAddress } from "../inspection/addressing.ts";
import {
  inspectionProtocolRegistry,
  type InspectionDocument,
  type InspectionOperation,
  type InspectionOperationId,
} from "../inspection/protocol.ts";

const help = (summary: string) => Object.freeze({ summary, visibility: "public" as const });
const option = (value: CliOptionDefinition): CliOptionDefinition => Object.freeze(value);
export const SHOW_CLI_OPTIONS = Object.freeze({
  json: option({ type: "boolean", help: help("Print Inspection documents as JSON Lines.") }),
  explain: option({ type: "boolean", help: help("Explain the facts read by this selection.") }),
  record: option({ type: "string", help: help("Read an external Record.") }),
  all: option({ type: "boolean", help: help("Show Attempts hidden by the compact Results view.") }),
  continuation: option({ type: "string", help: help("Read the next page with the same selection and filters.") }),
  actor: option({ type: "string", help: help("Filter execution events by exact actor ID.") }),
  type: option({ type: "string", help: help("Filter execution events by exact event type.") }),
  eval: option({ type: "string", help: help("Filter the Experiment assertions matrix by Eval prefix.") }),
  reprice: option({ type: "string", help: help("Reprice usage using a JSON pricing file.") }),
  full: option({ type: "boolean", help: help("Include complete materials for one Assertion ID.") }),
  output: option({ type: "string", help: help("Write an Assertion image to this file.") }),
  help: option({ type: "boolean", short: "h", help: help("Print show help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);
export const COMPARE_CLI_OPTIONS = Object.freeze({
  json: option({ type: "boolean", help: help("Print Inspection documents as JSON Lines.") }),
  mode: option({ type: "string", help: help("Comparison mode: paired (default), side-by-side, or exact.") }),
  "max-regressions": option({ type: "string", help: help("Maximum allowed regressions; paired or exact mode.") }),
  help: option({ type: "boolean", short: "h", help: help("Print compare help.") }),
} satisfies Readonly<Record<string, CliOptionDefinition>>);
const SHOW_HELP = `niceeval show — inspect results in the terminal

Usage:
  niceeval show [@<locator> | exp:<id>... | run:<id>... | runs] [<aspect>] [<ID>]
  niceeval show @<locator> ae_<id> image <image-id> --output <file>
  niceeval show [<address>] [--record <file>] [--json] [--explain]

Attempt aspects: assertions, source, execution, timing, usage, diff, artifacts.
Stable IDs may replace the aspect: ae_, fc_, art_, and execution IDs.
Experiment aspect: assertions [--eval <prefix>].
Execution: --actor <id>, --type <type>, --continuation <token>.
Usage: --reprice <file>. Assertion ID: --full.
`;
const COMPARE_HELP = `niceeval compare <run>... -- <run>... [--mode paired|side-by-side|exact] [--max-regressions <n>] [--json]\n`;
type Requirements = CliArguments | CliInvocationFacts | CliOutput | ProjectConfiguration;
type Error = CliFeatureError;
const failure = (operation: string, cause: unknown, exitCode = 1) => {
  const detail =
    cause instanceof CurrentTargetUnavailable ||
    (cause instanceof InspectionOperationError && cause.code === "current-target-unavailable")
      ? `current-target-unavailable: ${cause.reason}\nRead fixed history: niceeval show run:<run-id>`
      : cause instanceof InspectionSourceError &&
          cause.cause instanceof SqliteRecordError &&
          cause.cause.code === "record-schema-unsupported"
        ? "This Record was written by an older version of NiceEval. Rerun the experiment or remove this Record storage."
        : cause instanceof InspectionIntegrityError
          ? `Record integrity failure for sealed Run ${cause.runId}.`
          : cause instanceof InspectionOperationError && cause.code === "inspection-record-integrity-failure"
            ? `Record integrity failure${cause.identity === undefined ? "" : ` for sealed Run ${cause.identity.runId}`}.`
            : cause instanceof InspectionOperationError
              ? cause.code === "unsupported-format" ||
                cause.code === "inspection-selection-missing" ||
                cause.code === "inspection-request-invalid" ||
                cause.code === "inspection-result-invalid"
                ? cause.reason
                : "The Inspection operation could not be completed."
              : undefined;
  return new CliFeatureError({
    feature: "show",
    operation,
    cause,
    exitCode,
    ...(detail === undefined ? {} : { display: `show ${operation} failed: ${detail}\n` }),
  });
};
const write = (channel: "stdout" | "stderr", value: string) =>
  Effect.flatMap(CliOutput, (output) =>
    channel === "stdout" ? output.writeStdout(value) : output.writeStderr(value),
  ).pipe(Effect.mapError((cause) => failure(`write ${channel}`, cause)));
const usage = (message: string) => write("stderr", `${message}\n`).pipe(Effect.as(1));

function runShow(
  argv: readonly string[],
  comparison?: {
    leftRunIds: readonly Schema.Schema.Type<typeof RunIdSchema>[];
    rightRunIds: readonly Schema.Schema.Type<typeof RunIdSchema>[];
    mode: "paired" | "exact" | "side-by-side";
    maxRegressions?: number;
  },
): Effect.Effect<number, Error, Requirements> {
  return Effect.gen(function* () {
    const parser = yield* CliArguments;
    const parsedResult = yield* Effect.try({
      try: () => parser.parse(argv, SHOW_CLI_OPTIONS),
      catch: (cause) => failure("parse arguments", cause),
    }).pipe(Effect.result);
    if (Result.isFailure(parsedResult)) return yield* usage(reason(parsedResult.failure.cause));
    const parsed = parsedResult.success;
    if (parsed.values.help === true) {
      yield* write("stdout", SHOW_HELP);
      return 0;
    }
    const addressResult = yield* Effect.try({
      try: () => parseInspectionAddress(parsed.positionals),
      catch: (cause) => failure("parse address", cause),
    }).pipe(Effect.result);
    if (Result.isFailure(addressResult)) return yield* usage(reason(addressResult.failure.cause));
    const address = addressResult.success;
    const locator = address.locator;
    const decodedLocator = locator === undefined ? undefined : parseAttemptLocator(locator);
    if (decodedLocator !== undefined && !decodedLocator.valid)
      return yield* usage(`Expected a canonical @<locator>; received ${JSON.stringify(locator)}.`);
    const runIds = parseRunIds([...address.runIds]);
    const experimentIds = parseExperimentIds([...address.experimentIds]);
    if (typeof runIds === "string") return yield* usage(runIds);
    if (typeof experimentIds === "string") return yield* usage(experimentIds);
    const json = parsed.values.json === true;
    const explain = parsed.values.explain === true;
    const assertions = address.aspect === "assertions";
    const source = address.aspect === "source";
    const execution = address.aspect === "execution";
    const timing = address.aspect === "timing";
    const showUsage = address.aspect === "usage";
    const diff = address.aspect === "diff";
    const artifacts = address.aspect === "artifacts";
    const runs = address.runs;
    const entryResult =
      assertions && address.id !== undefined
        ? Schema.decodeUnknownResult(AssertionEntryIdSchema)(address.id)
        : undefined;
    if (entryResult !== undefined && Result.isFailure(entryResult)) return yield* usage("Invalid Assertion ID.");
    const entryId = entryResult?.success;
    const full = parsed.values.full === true;
    const reference = false;
    const artifactId = artifacts ? address.id : undefined;
    const imageId = address.imageId;
    const imageOutput = typeof parsed.values.output === "string" ? parsed.values.output : undefined;
    const pricingFile = typeof parsed.values.reprice === "string" ? parsed.values.reprice : undefined;
    const changeId = diff ? address.id : undefined;
    const all = parsed.values.all === true;
    const expand = execution ? address.id : undefined;
    const actorId = typeof parsed.values.actor === "string" ? parsed.values.actor : undefined;
    const eventType = typeof parsed.values.type === "string" ? parsed.values.type : undefined;
    const continuation = typeof parsed.values.continuation === "string" ? parsed.values.continuation : undefined;
    const matrix = assertions && experimentIds.length > 0;
    const evalIdPrefix = typeof parsed.values.eval === "string" ? parsed.values.eval : undefined;
    if (full && entryId === undefined) return yield* usage("--full requires an ae_ Assertion ID.");
    if (pricingFile !== undefined && !showUsage) return yield* usage("--reprice requires usage.");
    if ((actorId !== undefined || eventType !== undefined) && (!execution || expand !== undefined))
      return yield* usage("--actor and --type require execution.");
    if (
      continuation !== undefined &&
      expand !== undefined &&
      !expand.startsWith("ev_") &&
      !/^[a-f0-9]{64}$/u.test(expand)
    )
      return yield* usage("--continuation requires execution evidence, artifacts, or a paged outline.");
    if (continuation !== undefined && !execution && !runs && !artifacts)
      return yield* usage("--continuation requires an execution outline or runs.");
    if (evalIdPrefix !== undefined && !matrix) return yield* usage("--eval requires exp:<id> assertions.");
    if (imageId !== undefined && (imageOutput === undefined || json || full || explain))
      return yield* usage("An Assertion image requires --output; --json, --explain, and --full are not accepted.");
    if (imageOutput !== undefined && imageId === undefined)
      return yield* usage("--output requires an Assertion image address.");
    if (all && (explain || json || locator !== undefined || runIds.length > 0 || experimentIds.length > 0 || runs))
      return yield* usage("--all applies only to the text Results overview.");
    const compare = comparison !== undefined;
    const leftRunIds = comparison?.leftRunIds ?? [];
    const rightRunIds = comparison?.rightRunIds ?? [];
    const mode = comparison?.mode ?? "paired";
    const maxRegressions = comparison?.maxRegressions;
    const facts = yield* Effect.flatMap(CliInvocationFacts, ({ facts }) => facts).pipe(
      Effect.mapError((cause) => failure("read invocation facts", cause)),
    );
    const inspectionSource =
      typeof parsed.values.record === "string"
        ? externalInspectionSource(facts.cwd, parsed.values.record)
        : operationalInspectionSource(facts.cwd);
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const current =
          !runs &&
          !compare &&
          decodedLocator === undefined &&
          runIds.length === 0 &&
          experimentIds.length === 0 &&
          typeof parsed.values.record !== "string";
        const prepare = current
          ? Effect.gen(function* () {
              const project = yield* ProjectConfiguration;
              const config = yield* project.load(facts.cwd).pipe(
                Effect.mapError(
                  (cause) =>
                    new CurrentTargetUnavailable({
                      code: "current-target-unavailable",
                      reason: String(cause),
                      cause,
                    }),
                ),
              );
              return yield* openCurrentProjectSource({ cwd: facts.cwd, config });
            })
          : openInspectionSource(inspectionSource);
        const opened = yield* prepare.pipe(Effect.mapError((cause) => failure("open Record source", cause)));
        const selectedDocuments: InspectionDocument[] = [];
        const select = <A>(operation: InspectionOperationId, evaluate: () => A): Effect.Effect<A, Error, CliOutput> =>
          Effect.try({
            try: () => {
              const document = evaluate();
              if (document !== null && typeof document === "object" && "outcome" in document)
                selectedDocuments.push(document as InspectionDocument);
              return document;
            },
            catch: (cause) => failure(`execute ${operation}`, cause, json ? INSPECTION_FAILURE_EXIT_CODE : 1),
          }).pipe(
            Effect.tapError((error) => (!json ? Effect.void : writeJson(inspectionFailureDocument(error, operation)))),
          );
        const project = <A>(operation: string, evaluate: () => A): Effect.Effect<A, Error> =>
          Effect.try({
            try: evaluate,
            catch: (cause) => failure(`project ${operation} result`, cause),
          });
        const withRecord = (document: InspectionDocument): InspectionDocument =>
          document.outcome !== "success" || typeof parsed.values.record !== "string"
            ? document
            : {
                ...document,
                links: document.links.map((link) => ({
                  ...link,
                  command: `${link.command} --record ${inspectionShellWord(parsed.values.record as string)}`,
                })),
              };
        const writeJson = (document: InspectionDocument) => {
          const encoded = canonicalInspectionJson(withRecord(document));
          return Result.isFailure(encoded)
            ? Effect.fail(
                failure(
                  "encode result",
                  new InspectionOperationError({
                    code: "inspection-result-invalid",
                    operation: document.operation!,
                    reason: encoded.failure.reason,
                  }),
                ),
              )
            : write("stdout", encoded.success);
        };
        const writeText = (text: string) => {
          const links = selectedDocuments.flatMap((document) =>
            document.outcome === "success" ? (withRecord(document) as typeof document).links : [],
          );
          const commands = [...new Set(links.map((link) => link.command))];
          const next = commands.length === 0 ? "" : `\nNext\n${commands.map((command) => `  ${command}`).join("\n")}\n`;
          const viewAddress = imageId === undefined ? parsed.positionals : [locator!, entryId!];
          const open =
            comparison !== undefined || typeof parsed.values.record === "string"
              ? ""
              : `\nOpen: niceeval view${viewAddress.length === 0 ? "" : " " + viewAddress.map(inspectionShellWord).join(" ")}\n`;
          return write("stdout", text + next + open);
        };
        const byteOffset =
          continuation === undefined || (expand === undefined && !artifacts)
            ? undefined
            : yield* Effect.try({
                try: () =>
                  inspectionByteOffset(continuation, {
                    cutoff: opened.cutoff().identity,
                    source: opened.kind,
                    locator: decodedLocator!.locator,
                    id: expand ?? artifactId ?? "artifacts",
                  }),
                catch: () =>
                  failure(
                    "read continuation",
                    new InspectionOperationError({
                      code: "restart-required",
                      operation: artifacts
                        ? artifactId === undefined
                          ? "attempt.artifacts"
                          : "attempt.artifact"
                        : "attempt.trace.detail",
                      reason: "Continuation does not match this object and cutoff; restart from the first page.",
                    }),
                    json ? INSPECTION_FAILURE_EXIT_CODE : 1,
                  ),
              }).pipe(Effect.tapError((error) => (json ? writeJson(inspectionFailureDocument(error)) : Effect.void)));
        if (explain) {
          const selectedLocator = decodedLocator?.locator;
          const entries =
            assertions && entryId === undefined && !matrix
              ? (yield* select("attempt.get", () =>
                  selectInspectionOperation(opened, { kind: "attempt.get", locator: selectedLocator! }),
                )).attempt.assertions.entries.map((entry) => entry.entryId)
              : entryId === undefined
                ? []
                : [entryId];
          const pricing =
            pricingFile === undefined
              ? undefined
              : yield* Effect.tryPromise({
                  try: async () =>
                    Schema.decodeUnknownSync(InspectionRepricingInputSchema, { onExcessProperty: "error" })(
                      JSON.parse(await readFile(resolve(facts.cwd, pricingFile), "utf8")),
                    ),
                  catch: (cause) => failure("read pricing", cause),
                });
          const operations: readonly InspectionOperation[] =
            pricing !== undefined
              ? [{ kind: "attempt.reprice", locator: selectedLocator!, pricing }]
              : expand !== undefined
                ? [
                    Schema.decodeUnknownSync(inspectionProtocolRegistry["attempt.trace.detail"].request)({
                      kind: "attempt.trace.detail",
                      locator: selectedLocator!,
                      selector: inspectionTraceSelector(expand, byteOffset),
                    }),
                  ]
                : runs
                  ? [{ kind: "run.list", ...(continuation === undefined ? {} : { continuation }) }]
                  : artifacts
                    ? [
                        {
                          kind: artifactId === undefined ? "attempt.artifacts" : "attempt.artifact",
                          locator: selectedLocator!,
                          ...(artifactId === undefined
                            ? {}
                            : { artifactId: Schema.decodeUnknownSync(ArtifactIdSchema)(artifactId) }),
                        } as InspectionOperation,
                      ]
                    : showOperations({
                        current,
                        runIds,
                        experimentIds,
                        locator: selectedLocator,
                        slice: address.aspect,
                        entryIds: entries,
                        projection: full ? "full" : "compact",
                        evalIdPrefix,
                        actorId,
                        eventType,
                        continuation,
                        changeId,
                      });
          for (const operation of operations) {
            const document = yield* Effect.try({
              try: () => explainInspectionOperation(opened, operation),
              catch: (cause) => failure("explain selection", cause),
            });
            yield* writeJson(document);
          }
          return 0;
        }
        if (runs || artifacts || pricingFile !== undefined || imageId !== undefined) {
          const selectedLocator = decodedLocator?.locator;
          if (imageId !== undefined) {
            const chunks: Uint8Array[] = [];
            let offset = 0;
            let expected: { byteLength: number; sha256: string } | undefined;
            const hash = new InspectionSha256();
            while (true) {
              const document = yield* select("attempt.assertion.image", () =>
                selectInspectionOperation(opened, {
                  kind: "attempt.assertion.image",
                  locator: selectedLocator!,
                  entryId: entryId!,
                  imageId,
                  offset,
                }),
              );
              const image = document.image;
              if (image.state !== "available") return yield* usage(`Assertion image is ${image.state}.`);
              expected ??= image;
              if (
                image.offset !== offset ||
                image.byteLength !== expected.byteLength ||
                image.sha256 !== expected.sha256
              )
                return yield* usage("Assertion image metadata changed between pages.");
              const bytes = decodeBase64Bytes(image.base64);
              chunks.push(bytes);
              hash.update(bytes);
              offset += bytes.byteLength;
              if (image.nextOffset === null) break;
              if (bytes.byteLength === 0 || image.nextOffset !== offset)
                return yield* usage("Invalid image continuation.");
            }
            if (offset !== expected!.byteLength || hash.digestHex() !== expected!.sha256)
              return yield* usage("Assertion image digest mismatch.");
            yield* Effect.tryPromise({
              try: () => writeFile(resolve(facts.cwd, imageOutput!), Buffer.concat(chunks)),
              catch: (cause) => failure("write image", cause),
            });
            yield* writeText(`Saved image to ${imageOutput}\n`);
            return 0;
          }
          const operation: InspectionOperation = runs
            ? { kind: "run.list", ...(continuation === undefined ? {} : { continuation }) }
            : artifacts
              ? artifactId === undefined
                ? {
                    kind: "attempt.artifacts",
                    locator: selectedLocator!,
                    ...(byteOffset === undefined ? {} : { offset: byteOffset }),
                  }
                : {
                    kind: "attempt.artifact",
                    locator: selectedLocator!,
                    ...(byteOffset === undefined ? {} : { offset: byteOffset }),
                    artifactId: yield* Effect.try({
                      try: () => Schema.decodeUnknownSync(ArtifactIdSchema)(artifactId),
                      catch: (cause) => failure("decode artifact", cause),
                    }),
                  }
              : {
                  kind: "attempt.reprice",
                  locator: selectedLocator!,
                  pricing: yield* Effect.tryPromise({
                    try: async () =>
                      Schema.decodeUnknownSync(InspectionRepricingInputSchema, { onExcessProperty: "error" })(
                        JSON.parse(await readFile(resolve(facts.cwd, pricingFile!), "utf8")),
                      ),
                    catch: (cause) => failure("read pricing", cause),
                  }),
                };
          const document = yield* select(operation.kind, () => selectInspectionOperation(opened, operation));
          if (json) yield* writeJson(document);
          else yield* writeText(renderAdditionalProjection(document));
          return 0;
        }
        if (matrix) {
          const document = yield* select("experiments.assertions", () =>
            selectInspectionOperation(opened, {
              kind: "experiments.assertions",
              experimentIds,
              ...(evalIdPrefix === undefined ? {} : { evalIdPrefix }),
            }),
          );
          if (json) yield* writeJson(document);
          else yield* writeText(renderAssertionMatrix(document.matrix));
          return 0;
        }
        if (json && !compare) {
          const selectedLocator = decodedLocator?.locator;
          const entries =
            assertions && entryId === undefined
              ? (yield* select("attempt.get", () =>
                  selectInspectionOperation(opened, { kind: "attempt.get", locator: selectedLocator! }),
                )).attempt.assertions.entries.map((entry) => entry.entryId)
              : entryId === undefined
                ? []
                : [entryId];
          const operations = showOperations({
            current,
            runIds,
            experimentIds,
            locator: selectedLocator,
            slice: assertions
              ? "assertions"
              : source
                ? "source"
                : execution
                  ? "execution"
                  : timing
                    ? "timing"
                    : showUsage
                      ? "usage"
                      : diff
                        ? "diff"
                        : undefined,
            changeId,
            entryIds: entries,
            projection: full ? "full" : "compact",
            actorId,
            eventType,
            continuation,
          });
          for (const operation of operations) {
            const document = yield* select(
              execution && expand !== undefined ? "attempt.trace.detail" : operation.kind,
              () =>
                execution && expand !== undefined
                  ? selectTraceDetailByStableId(opened, selectedLocator!, expand, byteOffset)
                  : selectInspectionOperation(opened, operation),
            );
            yield* writeJson(document);
          }
          return 0;
        }
        if (assertions) {
          const selectedLocator = decodedLocator!.locator;
          const attempt = (yield* select("attempt.get", () =>
            selectInspectionOperation(opened, { kind: "attempt.get", locator: selectedLocator }),
          )).attempt;
          const entryIds = entryId === undefined ? attempt.assertions.entries.map((entry) => entry.entryId) : [entryId];
          const details: InspectionSuccessDocumentFor<"attempt.assertion.detail">["assertion"][] = [];
          for (const id of entryIds) {
            const document = yield* select("attempt.assertion.detail", () =>
              selectInspectionOperation(opened, {
                kind: "attempt.assertion.detail",
                locator: selectedLocator,
                entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)(id),
                projection: full ? "full" : "compact",
              }),
            );
            details.push(document.assertion);
          }
          const agentJudgeTraces = new Map<string, AgentJudgeTrace>();
          if (full)
            for (const detail of details) {
              const audit = "entry" in detail ? detail.entry.agentJudgeAudit : undefined;
              if (audit?.state !== "available" || agentJudgeTraces.has(audit.audit.trace.id)) continue;
              const reference = audit.audit.trace;
              const bytes = new Uint8Array(reference.byteLength);
              let offset = 0;
              while (true) {
                const document = yield* select("attempt.trace.detail", () =>
                  selectInspectionOperation(opened, {
                    kind: "attempt.trace.detail",
                    locator: selectedLocator,
                    selector: { kind: "execution-evidence", evidenceId: reference.id, offset, limit: 256 * 1024 },
                  }),
                );
                const page = document.detail;
                if (
                  page.kind !== "execution-evidence" ||
                  page.offset !== offset ||
                  page.targetByteLength !== reference.byteLength ||
                  page.targetSha256 !== reference.sha256
                )
                  throw new Error("Invalid Assertion Content page");
                const chunk = decodeBase64Bytes(page.base64);
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
                if (page.nextOffset === null) break;
                if (page.nextOffset !== offset || chunk.byteLength === 0)
                  throw new Error("Invalid Assertion Content continuation");
              }
              if (offset !== bytes.byteLength || new InspectionSha256().update(bytes).digestHex() !== reference.sha256)
                throw new Error("Invalid Assertion Content digest");
              agentJudgeTraces.set(
                reference.id,
                decodeAgentJudgeTrace(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))),
              );
            }
          yield* writeText(
            renderAssertions(selectedLocator, details, {
              full,
              agentJudgeTraces,
              entryId,
              verdict: attempt.verdict ?? "unavailable",
              score: attempt.score,
            }),
          );
          return 0;
        }
        if (compare) {
          const document = yield* select("runs.compare", () =>
            selectInspectionOperation(opened, {
              kind: "runs.compare",
              mode,
              leftRunIds,
              rightRunIds,
            }),
          );
          if (json) yield* writeJson(document);
          if (json && maxRegressions === undefined) return 0;
          if (document.issues.length > 0)
            return yield* usage(`Comparison incomplete: ${document.issues.map((issue) => issue.code).join(", ")}.`);
          const attempts = new Map<string, ReturnType<typeof projectAttempt>>();
          for (const member of [...document.comparison.left.members, ...document.comparison.right.members]) {
            if (attempts.has(member.locator)) continue;
            const attempt = yield* select("attempt.get", () =>
              selectInspectionOperation(opened, { kind: "attempt.get", locator: member.locator }),
            );
            const usageDocument = yield* select("attempt.usage", () =>
              selectInspectionOperation(opened, { kind: "attempt.usage", locator: member.locator }),
            );
            attempts.set(member.locator, yield* project("attempt.get", () => projectAttempt(attempt, usageDocument)));
          }
          if (!json) yield* writeText(renderComparison(document.comparison, attempts));
          const regressed = comparisonRegressions(document.comparison, attempts);
          if (comparisonGateExitCode(regressed, maxRegressions) === 1) {
            yield* write("stderr", `Regression gate failed: ${regressed} regressed; maximum ${maxRegressions}.\n`);
            return 1;
          }
          return 0;
        }
        if (decodedLocator === undefined && runIds.length === 0 && experimentIds.length === 0) {
          if (current) {
            const document = yield* select("project.get", () =>
              selectInspectionOperation(opened, { kind: "project.get" }),
            );
            const references = new Map<string, InspectionSuccessDocumentFor<"attempt.get">["attempt"]>();
            for (const slot of document.project.plannedAttempts) {
              if (slot.state !== "gap" || slot.previous === null || references.has(slot.previous.locator)) continue;
              const previous = slot.previous;
              const attempt = yield* select("attempt.get", () =>
                selectInspectionOperation(opened, { kind: "attempt.get", locator: previous.locator }),
              );
              references.set(previous.locator, attempt.attempt);
            }
            if (reference) {
              yield* writeText(renderReferences(document.project, references));
              return 0;
            }
            // The presentation model only extracts already-closed aggregate fields.
            const view = yield* project("project.get", () =>
              projectOverview({ ...document, operation: "overview.get", overview: document.project }),
            );
            yield* writeText(renderOverview(view, { all, current: document.project, references }));
            return 0;
          }
          const document = yield* select("overview.get", () =>
            selectInspectionOperation(opened, { kind: "overview.get" }),
          );
          yield* writeText(
            renderOverview(yield* project("overview.get", () => projectOverview(document)), { all, recorded: true }),
          );
          return 0;
        }
        if (runIds.length > 0) {
          const rendered: string[] = [];
          for (const runId of runIds) {
            const document = yield* select("run.get", () =>
              selectInspectionOperation(opened, {
                kind: "run.get",
                runId,
              }),
            );
            rendered.push(renderRun(yield* project("run.get", () => projectRun(document))));
          }
          yield* writeText(rendered.join(""));
          return 0;
        }
        if (experimentIds.length > 0) {
          const rendered: string[] = [];
          for (const experimentId of experimentIds) {
            const document = yield* select("experiment.get", () =>
              selectInspectionOperation(opened, {
                kind: "experiment.get",
                experimentId,
              }),
            );
            rendered.push(renderExperiment(yield* project("experiment.get", () => projectExperiment(document))));
          }
          yield* writeText(rendered.join(""));
          return 0;
        }
        const selectedLocator = decodedLocator!.locator;
        if (source) {
          const document = yield* select("attempt.sources", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.sources",
              locator: selectedLocator,
            }),
          );
          yield* writeText(
            renderSources(yield* project("attempt.sources", () => projectSources(document, selectedLocator))),
          );
          return 0;
        }
        if (execution) {
          if (expand !== undefined) {
            const detail = yield* select("attempt.trace.detail", () =>
              selectTraceDetailByStableId(opened, selectedLocator, expand, byteOffset),
            );
            yield* writeText(
              renderTraceDetail(
                yield* project("attempt.trace.detail", () => projectTraceDetail(detail, selectedLocator)),
              ),
            );
            return 0;
          }
          const outline = yield* select("attempt.trace", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.trace",
              locator: selectedLocator,
              ...(actorId === undefined ? {} : { actorId }),
              ...(eventType === undefined ? {} : { eventType }),
              ...(continuation === undefined ? {} : { continuation }),
            }),
          );
          const trace = yield* project("attempt.trace", () => projectTrace(outline, selectedLocator));
          yield* writeText(renderTrace(trace));
          return 0;
        }
        if (timing) {
          const document = yield* select("attempt.timing", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.timing",
              locator: selectedLocator,
            }),
          );
          yield* writeText(
            renderTiming(yield* project("attempt.timing", () => projectTiming(document, selectedLocator))),
          );
          return 0;
        }
        if (showUsage) {
          const document = yield* select("attempt.usage", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.usage",
              locator: selectedLocator,
            }),
          );
          yield* writeText(renderUsage(yield* project("attempt.usage", () => projectUsage(document, selectedLocator))));
          return 0;
        }
        if (diff) {
          const document = yield* select("attempt.diff", () =>
            selectInspectionOperation(opened, {
              kind: "attempt.diff",
              locator: selectedLocator,
              ...(changeId === undefined ? {} : { changeId }),
            }),
          );
          yield* writeText(renderDiff(yield* project("attempt.diff", () => projectDiff(document, selectedLocator))));
          return 0;
        }
        const document = yield* select("attempt.get", () =>
          selectInspectionOperation(opened, {
            kind: "attempt.get",
            locator: selectedLocator,
          }),
        );
        const attemptUsage = yield* select("attempt.usage", () =>
          selectInspectionOperation(opened, { kind: "attempt.usage", locator: selectedLocator }),
        );
        yield* writeText(renderAttempt(yield* project("attempt.get", () => projectAttempt(document, attemptUsage))));
        return 0;
      }),
    );
  });
}

export function selectTraceDetailByStableId(
  source: InspectionFactSource,
  locator: string,
  stableId: string,
  offset?: number,
): InspectionSuccessDocumentFor<"attempt.trace.detail"> {
  const decoded = Schema.decodeUnknownResult(
    // Branded persisted identities are decoded at the operation boundary.
    inspectionProtocolRegistry["attempt.trace.detail"].request,
  )({ kind: "attempt.trace.detail", locator, selector: inspectionTraceSelector(stableId, offset) });
  if (Result.isFailure(decoded))
    throw new InspectionOperationError({
      code: "inspection-request-invalid",
      operation: "attempt.trace.detail",
      reason: `Invalid execution ID ${JSON.stringify(stableId)}.`,
    });
  return selectInspectionOperation(source, decoded.success);
}

function parseRunIds(
  value: string | boolean | string[] | undefined,
  flag = "run",
): readonly Schema.Schema.Type<typeof RunIdSchema>[] | string {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output: Schema.Schema.Type<typeof RunIdSchema>[] = [];
  for (const candidate of values) {
    const decoded = Schema.decodeUnknownResult(RunIdSchema)(candidate);
    if (Result.isFailure(decoded)) return `Invalid --${flag} value ${JSON.stringify(candidate)}.`;
    if (!output.includes(decoded.success)) output.push(decoded.success);
  }
  return Object.freeze(output.sort(compareIdentity));
}

function parseExperimentIds(
  value: string | boolean | string[] | undefined,
): readonly Schema.Schema.Type<typeof ExperimentIdSchema>[] | string {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output: Schema.Schema.Type<typeof ExperimentIdSchema>[] = [];
  for (const candidate of values) {
    const decoded = Schema.decodeUnknownResult(ExperimentIdSchema)(candidate);
    if (Result.isFailure(decoded)) return `Invalid --experiment value ${JSON.stringify(candidate)}.`;
    if (!output.includes(decoded.success)) output.push(decoded.success);
  }
  return Object.freeze(output.sort(compareIdentity));
}
function compareIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function reason(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export const showCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "show",
  summary: "inspect results in the terminal",
  options: SHOW_CLI_OPTIONS,
  run: runShow,
});

export const compareCliCommand: CliCommandContribution<Requirements, Error> = Object.freeze({
  name: "compare",
  summary: "compare two groups of Runs",
  options: COMPARE_CLI_OPTIONS,
  run: (argv: readonly string[]) =>
    Effect.gen(function* () {
      const parser = yield* CliArguments;
      const separator = argv.indexOf("--");
      if (argv.includes("--help") || argv.includes("-h")) {
        yield* write("stdout", COMPARE_HELP);
        return 0;
      }
      if (separator < 1) return yield* usage(COMPARE_HELP);
      const left = yield* Effect.try({
        try: () => parser.parse(argv.slice(0, separator), COMPARE_CLI_OPTIONS),
        catch: (cause) => failure("parse compare", cause),
      });
      const right = yield* Effect.try({
        try: () => parser.parse(argv.slice(separator + 1), COMPARE_CLI_OPTIONS),
        catch: (cause) => failure("parse compare", cause),
      });
      const leftRunIds = parseRunIds(left.positionals.map((id) => id.replace(/^run:/, "")));
      const rightRunIds = parseRunIds(right.positionals.map((id) => id.replace(/^run:/, "")));
      if (typeof leftRunIds === "string") return yield* usage(leftRunIds);
      if (typeof rightRunIds === "string") return yield* usage(rightRunIds);
      if (!leftRunIds.length || !rightRunIds.length) return yield* usage(COMPARE_HELP);
      const values = { ...left.values, ...right.values };
      const mode = values.mode ?? "paired";
      if (mode !== "paired" && mode !== "exact" && mode !== "side-by-side")
        return yield* usage("--mode must be paired, exact, or side-by-side.");
      const threshold = values["max-regressions"];
      const maxRegressions = threshold === undefined ? undefined : Number(threshold);
      if (
        threshold !== undefined &&
        (typeof threshold !== "string" || !/^[0-9]+$/.test(threshold) || !Number.isSafeInteger(maxRegressions))
      )
        return yield* usage("--max-regressions must be a non-negative safe integer.");
      if (mode === "side-by-side" && maxRegressions !== undefined)
        return yield* usage("--max-regressions requires paired or exact mode.");
      return yield* runShow(values.json === true ? ["--json"] : [], { leftRunIds, rightRunIds, mode, maxRegressions });
    }),
});

export function comparisonGateExitCode(regressed: number, maximum: number | undefined): 0 | 1 {
  return maximum !== undefined && regressed > maximum ? 1 : 0;
}

/** Fixed document order for the resource-oriented JSON Lines view. */
export function showOperations(input: {
  readonly current: boolean;
  readonly runIds: readonly InspectionOperationFor<"run.get">["runId"][];
  readonly experimentIds: readonly InspectionOperationFor<"experiment.get">["experimentId"][];
  readonly locator?: string;
  readonly evalIdPrefix?: string;
  readonly slice?: "assertions" | "source" | "execution" | "timing" | "usage" | "diff";
  readonly entryIds?: readonly string[];
  readonly projection?: "compact" | "full";
  readonly actorId?: string;
  readonly eventType?: string;
  readonly continuation?: string;
  readonly changeId?: string;
}): readonly InspectionOperation[] {
  if (input.runIds.length > 0) return input.runIds.map((runId) => ({ kind: "run.get", runId }));
  if (input.experimentIds.length > 0 && input.slice === "assertions")
    return [
      {
        kind: "experiments.assertions",
        experimentIds: [...new Set(input.experimentIds)].sort(),
        ...(input.evalIdPrefix === undefined ? {} : { evalIdPrefix: input.evalIdPrefix }),
      },
    ];
  if (input.experimentIds.length > 0)
    return input.experimentIds.map((experimentId) => ({ kind: "experiment.get", experimentId }));
  const locator = input.locator;
  if (locator === undefined) return [{ kind: input.current ? "project.get" : "overview.get" }];
  switch (input.slice) {
    case "assertions":
      return (input.entryIds ?? []).map((entryId) => ({
        kind: "attempt.assertion.detail",
        locator,
        entryId: Schema.decodeUnknownSync(AssertionEntryIdSchema)(entryId),
        projection: input.projection ?? "compact",
      }));
    case "source":
      return [{ kind: "attempt.sources", locator }];
    case "execution":
      return [
        {
          kind: "attempt.trace",
          locator,
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
          ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
        },
      ];
    case "timing":
      return [{ kind: "attempt.timing", locator }];
    case "usage":
      return [{ kind: "attempt.usage", locator }];
    case "diff":
      return [{ kind: "attempt.diff", locator, ...(input.changeId === undefined ? {} : { changeId: input.changeId }) }];
    default:
      return [
        { kind: "attempt.get", locator },
        { kind: "attempt.usage", locator },
      ];
  }
}

function renderAdditionalProjection(document: InspectionDocument): string {
  if (document.outcome !== "success") return "Inspection unavailable\n";
  if (document.operation === "run.list")
    return `Runs\n${document.runs.map((run) => `${run.runId}  ${run.state}`).join("\n")}\n`;
  if (document.operation === "attempt.reprice")
    return `Repriced costs  ${document.repricing.total.amount ?? "unknown"} USD (${document.repricing.total.state})\nApplication  ${document.repricing.application.amount ?? "unknown"}\nJudge  ${document.repricing.judge.amount ?? "unknown"}\n`;
  if (document.operation === "attempt.artifacts") {
    const artifacts = document.artifacts;
    return `Artifacts  ${artifacts.state}\n${artifacts.state !== "available" ? "" : artifacts.value.artifacts.map((artifact) => `${artifact.artifactId}  ${artifact.label}  ${artifact.mediaType}  ${artifact.byteLength} bytes`).join("\n")}\n`;
  }
  if (document.operation === "attempt.artifact")
    return `Artifact  ${document.artifact.state}\n${document.artifact.state !== "available" ? "" : `${document.artifact.mediaType}  ${document.artifact.byteLength} bytes\n${document.artifact.base64}\n`}`;
  return "";
}
