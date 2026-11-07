import { realpathSync } from "node:fs";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { Cause, Effect, Schema } from "effect";
import { repoRootDir } from "./discovery.ts";
import { CollectionSchema, observeExecution } from "./adapter-observation.ts";
import { ADAPTER_BYTES, CAPABILITY_VERSION, ContextSchema, ManifestSchema, PayloadSchemas, PlanSchema, ReportSchema, RequestSchema, SelectionSchema, Text, capabilities, decode, json, nativeId, parse, type Captured, type Context, type NativeResult, type Selection } from "./adapter-wire.ts";

const BindingSchema = Schema.Struct({ nativeId: Text, selection: SelectionSchema });
const CollectContextSchema = Schema.Struct({ context: ContextSchema, files: Schema.Array(Text), invocationId: Text });
const RunContextSchema = Schema.Struct({ context: ContextSchema, bindings: Schema.Array(BindingSchema) });
const sameContext = (actual: Context, expected: Context): void => {
  if (json(actual) !== json(expected)) throw new Error("adapter plan context mismatch");
};
const normal = (capture: Captured): boolean => capture.status.exitCode !== null && capture.status.signal === null && !capture.status.timedOut && !capture.status.cancelled && !capture.status.outputTruncated && capture.status.cleanup === "complete";
const reportValue = (capture: Captured): unknown => {
  if (capture.reports.length !== 1 || capture.reports[0]!.path !== "observation.json") throw new Error("missing native observation report");
  return parse(capture.reports[0]!.text);
};
const invocation = (context: Context, invocationId: string, payload: unknown, requested?: readonly string[]) => ({
  invocationId,
  argv: ["pnpm", "exec", "tsx", "packages/e2e-runner/src/adapter-host.ts", json({ ...decode(Schema.Record(Schema.String, Schema.Unknown), payload), report: join(context.reportDirectory, invocationId, "observation.json") })],
  cwd: ".", envNames: ["PATH", "HOME"], reports: ["observation.json"], ...(requested === undefined ? {} : { requested }),
});
function execute(request: typeof RequestSchema.Type): unknown {
  const context = request.context;
  switch (request.op) {
    case "collect-plan": {
      const payload = decode(PayloadSchemas[request.op], request.payload);
      if (new Set(payload.files).size !== payload.files.length) throw new Error("duplicate collection files");
      const invocationId = "collect";
      return decode(PlanSchema, { invocations: [invocation(context, invocationId, { op: "collect", files: payload.files })], planContext: { context, files: payload.files, invocationId } });
    }
    case "collect-parse": {
      const payload = decode(PayloadSchemas[request.op], request.payload);
      const plan = decode(CollectContextSchema, payload.planContext);
      sameContext(plan.context, context);
      const gaps: string[] = [];
      const cases: Array<typeof ManifestSchema.Type.cases[number]> = [];
      const nativeGroups = new Map<string, string>();
      if (payload.captures.length !== 1 || payload.captures[0]?.status.invocationId !== plan.invocationId) throw new Error("collection captures do not match plan");
      const capture = payload.captures[0]!;
      if (!normal(capture) || capture.status.exitCode !== 0) gaps.push("Native collection did not complete normally");
      else {
        const collection = decode(CollectionSchema, reportValue(capture));
        gaps.push(...collection.gaps);
        for (const selection of collection.selections) {
          if (!plan.files.includes(selection.file)) throw new Error("native case is outside requested files");
          const id = nativeId(selection);
          const range = collection.ranges[id];
          if (range !== undefined && collection.groups[id] !== undefined) nativeGroups.set(id, collection.groups[id]);
          cases.push({ nativeId: id, project: selection.project, file: selection.file, kind: "leaf", ...(range === undefined ? {} : { range }), selection: { opaqueId: json(selection), capabilityVersion: CAPABILITY_VERSION }, tags: {}, provenance: `NiceEval isolated ${selection.executor} native collection${range === undefined ? "" : "; native location and source AST declaration end"}` });
        }
      }
      if (new Set(cases.map(item => item.nativeId)).size !== cases.length) throw new Error("duplicate native case identity");
      // Missing range does not mean missing collection; binding must use @native.
      const groupKey = (item: typeof cases[number]) => json([item.file, item.project, nativeGroups.get(item.nativeId) ?? ""]);
      const groupCounts = new Map<string, number>();
      for (const item of cases) if (nativeGroups.has(item.nativeId)) groupCounts.set(groupKey(item), (groupCounts.get(groupKey(item)) ?? 0) + 1);
      const grouped = cases.map(item => (groupCounts.get(groupKey(item)) ?? 0) > 1 ? { ...item, group: nativeGroups.get(item.nativeId)! } : item);
      if (cases.some(item => item.range === undefined)) process.stderr.write("Some NiceEval native positions could not be matched to source declarations; those declarations require explicit @native bindings.\n");
      return decode(ManifestSchema, { cases: grouped, capabilities: { ...capabilities, range: cases.some(item => item.range !== undefined), parameterGroups: grouped.some(item => "group" in item) }, completeness: { complete: gaps.length === 0, gaps } });
    }
    case "select-plan": {
      const payload = decode(PayloadSchemas[request.op], request.payload);
      if (payload.manifestInputs !== context.inputs || new Set(payload.nativeIds).size !== payload.nativeIds.length) throw new Error("selection inputs or identities mismatch");
      const bindings = payload.nativeIds.map(id => {
        const matches = payload.manifest.cases.filter(item => item.nativeId === id);
        if (matches.length !== 1) throw new Error("selection must resolve to one manifest item");
        const item = matches[0]!;
        if (item.kind !== "leaf" || item.selection.capabilityVersion !== CAPABILITY_VERSION) throw new Error("unsupported selection capability");
        const selection = decode(SelectionSchema, parse(item.selection.opaqueId));
        if (nativeId(selection) !== id || selection.file !== item.file || selection.project !== item.project) throw new Error("opaque selection identity mismatch");
        if (!selection.file.startsWith(`e2e/${selection.repo}/`) || selection.nativeFile !== undefined && !selection.nativeFile.startsWith(`e2e/${selection.repo}/`)) throw new Error("selection file is outside native repo");
        return { nativeId: id, selection };
      });
      return decode(PlanSchema, { invocations: bindings.map((binding, index) => invocation(context, `case-${index}`, { op: "test", selection: binding.selection }, [binding.nativeId])), planContext: { context, bindings } });
    }
    case "report-parse": {
      const payload = decode(PayloadSchemas[request.op], request.payload);
      const plan = decode(RunContextSchema, payload.planContext);
      sameContext(plan.context, context);
      if (json(payload.requested) !== json(plan.bindings.map(binding => binding.nativeId))) throw new Error("requested selection differs from plan");
      const gaps: string[] = [];
      const observed: NativeResult[] = [];
      if (payload.captures.length !== plan.bindings.length || new Set(payload.captures.map(capture => capture.status.invocationId)).size !== payload.captures.length) gaps.push("Invocation captures are missing or duplicated");
      for (const [index, binding] of plan.bindings.entries()) {
        const capture = payload.captures.find(item => item.status.invocationId === `case-${index}`);
        if (!capture || !normal(capture)) { gaps.push(`Native invocation incomplete: ${binding.nativeId}`); continue; }
        try { observed.push(observeExecution(reportValue(capture), binding.selection, binding.nativeId)); }
        catch (cause) { gaps.push(`Native observation unavailable: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }
      if (payload.captures.some(item => !/^case-(0|[1-9]\d*)$/u.test(item.status.invocationId) || Number(item.status.invocationId.slice(5)) >= plan.bindings.length)) gaps.push("Unexpected native invocation capture");
      return decode(ReportSchema, { observed, capabilities, completeness: { complete: gaps.length === 0, gaps } });
    }
  }
}
const readRequest = Effect.tryPromise(async () => {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > ADAPTER_BYTES) { process.stdin.destroy(); throw new Error("adapter request exceeds 8 MiB"); }
    chunks.push(buffer);
  }
  return decode(RequestSchema, parse(Buffer.concat(chunks)));
});
NodeRuntime.runMain(Effect.gen(function*() {
  const request = yield* readRequest;
  const response = yield* Effect.sync(() => {
    const root = realpathSync(repoRootDir());
    if (request.context.root !== root || realpathSync(process.cwd()) !== root) throw new Error("adapter root mismatch");
    return json({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload: execute(request) });
  });
  yield* Effect.tryPromise(() => new Promise<void>((resolve, reject) => process.stdout.write(response + "\n", error => error ? reject(error) : resolve())));
}).pipe(Effect.catchCause(cause => Effect.sync(() => { process.stderr.write(Cause.pretty(cause) + "\n"); process.exitCode = 1; }))), { disableErrorReporting: true });
