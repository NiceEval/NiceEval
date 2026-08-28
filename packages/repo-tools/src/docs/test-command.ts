import { Argument as Args, Command, Flag as Options } from "effect/unstable/cli";
import { Effect, Option, Result } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  defineDocsCommandContribution,
  deliverDomainResult,
  jsonDocument,
  type TerminalDeliverySink,
} from "./contribution.js";
import { REPOSITORY_ROOT } from "./runtime.js";
import { renderTraceFailure } from "./trace-command-presentation.js";
import {
  compileTraceUnderLease,
  compileTrace,
  listTests,
  renderTestListReceipt,
  renderTraceReceipt,
  showTest,
  type TestListReceipt,
  type TestShowReceipt,
  type TraceSnapshot,
} from "./trace/index.js";
import { TraceFormatError } from "./trace/errors.js";
import { mutateTraceOwner, traceDigest } from "./trace/relation-mutation.js";

type TestReceipt = TestListReceipt | TestShowReceipt;

const jsonOption = Options.boolean("json").pipe(
  Options.withDefault(false),
  Options.withDescription("Emit this test-owner receipt as JSON."),
);
const dryRunOption = Options.boolean("dry-run").pipe(Options.withDefault(false));
const expectedDigestOption = Options.string("expected-digest").pipe(
  Options.withDescription("SHA-256 owner digest returned by test show."),
);

type RelationName = "owner" | "regression" | "issue";

function headerValues(source: string): Record<RelationName, string[]> {
  const values: Record<RelationName, string[]> = { owner: [], regression: [], issue: [] };
  for (const line of source.split(/\r?\n/u)) {
    if (!line.startsWith("//")) break;
    const match = /^\/\/\s+(owner|regression|issue):\s*(\S.*?)\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) values[match[1] as RelationName].push(match[2]);
  }
  return values;
}

function replaceHeader(source: string, values: Record<RelationName, string[]>): string {
  const lines = source.split(/(?<=\n)/u);
  let boundary = 0;
  while (boundary < lines.length && lines[boundary]?.startsWith("//") === true) boundary += 1;
  const retained = lines.slice(0, boundary).filter((line) => !/^\/\/\s+(owner|regression|issue):/u.test(line));
  const canonical = [
    ...values.owner.map((value) => `// owner: ${value}\n`),
    ...[...new Set(values.regression)].sort().map((value) => `// regression: ${value}\n`),
    ...[...new Set(values.issue)].sort().map((value) => `// issue: ${value}\n`),
  ];
  return [...canonical, ...retained, ...lines.slice(boundary)].join("");
}

function mutateTest(options: {
  readonly test: string;
  readonly expectedDigest: string;
  readonly operation: string;
  readonly dryRun: boolean;
  readonly validate?: (snapshot: TraceSnapshot) => Result.Result<void, TraceFormatError>;
  readonly update: (values: Record<RelationName, string[]>) => Result.Result<Record<RelationName, string[]>, TraceFormatError>;
}) {
  return mutateTraceOwner({
    root: REPOSITORY_ROOT,
    operation: options.operation,
    ownerPath: options.test,
    dryRun: options.dryRun,
    prepareUnderLease: compileTraceUnderLease(REPOSITORY_ROOT).pipe(Effect.flatMap((snapshot) => Effect.gen(function*() {
      if (!snapshot.tests.some((test) => test.path === options.test)) return yield* new TraceFormatError({ path: options.test, subject: "test", message: "test owner is not in the Trace snapshot" });
      if (options.validate !== undefined) yield* Effect.fromResult(options.validate(snapshot));
      return { generation: snapshot.generation, snapshotDigest: snapshot.digest };
    }))),
    plan: ({ source }) => Effect.gen(function*() {
      if (source === undefined) return yield* new TraceFormatError({ path: options.test, subject: "test", message: "test file is missing" });
      if (traceDigest(source) !== options.expectedDigest) return yield* new TraceFormatError({ path: options.test, subject: "test", message: "expected digest is stale; run docs test show again" });
      const before = headerValues(source);
      const after = yield* Effect.fromResult(options.update(before));
      return { bytes: replaceHeader(source, after), value: { path: options.test, relations: after }, changes: { before, after, qualityVerified: false } };
    }),
  });
}

function makeTestCommand(deliver: TerminalDeliverySink) {
  const present = {
    success: (receipt: TestReceipt, json: boolean) => json
      ? jsonDocument(receipt)
      : `${renderTraceReceipt(receipt)}\n`,
    failure: renderTraceFailure,
  };

  const list = Command.make("list", {
    pattern: Args.string("pattern").pipe(Args.optional),
    json: jsonOption,
  }, ({ json, pattern }) => {
    const selected = Option.getOrUndefined(pattern);
    const program = compileTrace(REPOSITORY_ROOT).pipe(
      Effect.flatMap((snapshot) => {
        const receipt = listTests(snapshot, selected === undefined ? {} : { pattern: selected });
        if (json) return Effect.succeed({ receipt, rendered: "" });
        return Effect.forEach(receipt.tests, (item) => showTest(snapshot, item.path)).pipe(
          Effect.map((details) => ({ receipt, rendered: renderTestListReceipt(receipt, details) })),
        );
      }),
    );
    return deliverDomainResult(program, json, {
      success: ({ receipt, rendered }, structured) => structured
        ? jsonDocument(receipt)
        : `${rendered}\n`,
      failure: renderTraceFailure,
    }, deliver);
  }).pipe(Command.withDescription(
    "List E2E tests with their Feature/Use Case, regression Memory, and Issue relations.",
  ));

  const show = Command.make("show", {
    test: Args.string("test-path"),
    json: jsonOption,
  }, ({ json, test }) => deliverDomainResult(
    compileTrace(REPOSITORY_ROOT).pipe(
      Effect.flatMap((snapshot) => showTest(snapshot, test)),
      Effect.map((receipt) => ({ ...receipt, ownerPreimageDigest: traceDigest(readFileSync(resolve(REPOSITORY_ROOT, receipt.test.path))) })),
    ),
    json,
    present,
    deliver,
  )).pipe(Command.withDescription(
    "Show the Features, Use Case, owner, and regressions for one E2E test.",
  ));

  const mutationPresent = {
    success: (receipt: unknown, json: boolean) => jsonDocument(receipt),
    failure: renderTraceFailure,
  };
  const ownerSet = Command.make("set", {
    test: Args.string("test-path"),
    to: Options.string("to").pipe(Options.withDescription("Existing exact owner contract ref.")),
    contract: Options.string("contract").pipe(Options.withDescription("Exact Feature or leaf Use Case ref.")),
    result: Options.string("result").pipe(Options.withDescription("Exact human-readable owner result.")),
    expectedDigest: expectedDigestOption,
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ contract, dryRun, expectedDigest, json, result, test, to }) => deliverDomainResult(mutateTest({
    test, expectedDigest, operation: "test-owner-set", dryRun,
    validate: (snapshot) => {
      const owner = snapshot.owners.find((item) => item.ref === to);
      if (owner === undefined || owner.contract !== contract || owner.description !== result) return Result.fail(new TraceFormatError({ path: test, subject: "owner", message: "owner ref, contract, and result must exactly match one declared owner" }));
      const other = snapshot.tests.find((item) => item.path !== test && item.owner === to);
      if (other !== undefined) return Result.fail(new TraceFormatError({ path: test, subject: "owner", message: `${to} is already owned by ${other.path}` }));
      return Result.succeed(undefined);
    },
    update: (values) => Result.succeed({ ...values, owner: [to] }),
  }), json, mutationPresent, deliver)).pipe(Command.withDescription("Set a test's existing exact owner relation."));
  const owner = Command.make("owner").pipe(Command.withSubcommands([ownerSet]));

  const addRelation = (name: "regression" | "issue", value: string, values: Record<RelationName, string[]>, test: string) => {
    const current = values[name];
    if (current.includes(value)) return Result.fail(new TraceFormatError({ path: test, subject: name, message: `${value} is already present` }));
    return Result.succeed({ ...values, [name]: [...current, value] });
  };
  const removeRelation = (name: "regression" | "issue", value: string, values: Record<RelationName, string[]>, test: string) => {
    const current = values[name];
    if (!current.includes(value)) return Result.fail(new TraceFormatError({ path: test, subject: name, message: `${value} is not present` }));
    return Result.succeed({ ...values, [name]: current.filter((item) => item !== value) });
  };
  const validateRegressionAdd = (snapshot: TraceSnapshot, value: string, test: string) => {
    const memory = snapshot.memory.find((item) => item.path === value.split("#", 1)[0]);
    return memory?.kind === "problem" && memory.state === "open"
      ? Result.succeed(undefined)
      : Result.fail(new TraceFormatError({ path: test, subject: "regression", message: "regression add requires an open structured Problem Memory" }));
  };
  const validateRegressionRemove = (snapshot: TraceSnapshot, value: string, test: string) => {
    const memory = snapshot.memory.find((item) => item.path === value.split("#", 1)[0]);
    return memory?.state === "resolved"
      ? Result.fail(new TraceFormatError({ path: test, subject: "regression", message: "reopen the resolved Problem before removing its regression owner" }))
      : Result.succeed(undefined);
  };
  const relationMutationCommand = (options: {
    readonly command: "add" | "remove";
    readonly argument: "memory-ref" | "issue-url";
    readonly operation: string;
    readonly validate?: (snapshot: TraceSnapshot, value: string, test: string) => Result.Result<void, TraceFormatError>;
    readonly update: (value: string, values: Record<RelationName, string[]>, test: string) => Result.Result<Record<RelationName, string[]>, TraceFormatError>;
  }) => Command.make(options.command, {
    test: Args.string("test-path"),
    value: Args.string(options.argument),
    expectedDigest: expectedDigestOption,
    dryRun: dryRunOption,
    json: jsonOption,
  }, ({ dryRun, expectedDigest, json, test, value }) => deliverDomainResult(mutateTest({
    test, expectedDigest, operation: options.operation, dryRun,
    validate: (snapshot) => options.validate?.(snapshot, value, test) ?? Result.succeed(undefined),
    update: (values) => options.update(value, values, test),
  }), json, mutationPresent, deliver));
  const regression = Command.make("regression").pipe(Command.withSubcommands([
    relationMutationCommand({ command: "add", argument: "memory-ref", operation: "test-regression-add", validate: validateRegressionAdd, update: (value, values, test) => addRelation("regression", value, values, test) }),
    relationMutationCommand({ command: "remove", argument: "memory-ref", operation: "test-regression-remove", validate: validateRegressionRemove, update: (value, values, test) => removeRelation("regression", value, values, test) }),
  ]));
  const issue = Command.make("issue").pipe(Command.withSubcommands([
    relationMutationCommand({ command: "add", argument: "issue-url", operation: "test-issue-add", update: (value, values, test) => addRelation("issue", value, values, test) }),
    relationMutationCommand({ command: "remove", argument: "issue-url", operation: "test-issue-remove", update: (value, values, test) => removeRelation("issue", value, values, test) }),
  ]));

  return Command.make("test").pipe(
    Command.withDescription("Discover E2E tests and the product contracts they protect."),
    Command.withSubcommands([list, show, owner, regression, issue]),
  );
}

export const testCommandContribution = defineDocsCommandContribution({
  name: "test",
  summary: "Discover E2E tests and the product contracts they protect.",
  makeCommand: makeTestCommand,
});
