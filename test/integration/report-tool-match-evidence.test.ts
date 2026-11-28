import fc from "fast-check";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createJudgeProject,
  narrowInspectionSuccess,
  planAndRunExperiment,
  readAssertionsList,
  readFullAssertionEntry,
  readPaginatedTrace,
  showJsonDocuments,
} from "./fixtures/judge-harness/harness.ts";

// The View is a Vite-bundled React app. Load its TSX modules and React from the niceeval package with tsx,
// render the Attempt assertion evidence exactly as the View does, and observe the static markup.
const insight = "../../packages/niceeval/src/view/app/features/insight";
const viewModules = {
  parentURL: import.meta.url,
  tsconfig: fileURLToPath(new URL("../../packages/niceeval/tsconfig.json", import.meta.url)),
};
// Structural views of the loaded modules: the test project carries no React or View type sources.
type ViewElement = { readonly type: unknown };
interface AssertionView {
  readonly evidence: unknown;
  readonly display: { readonly name: string };
  readonly decision: { readonly result: string };
}
const viewRequire = createRequire(new URL("../../packages/niceeval/package.json", import.meta.url));
const { createElement } = (await import(viewRequire.resolve("react"))) as {
  createElement: (type: unknown, props: Record<string, unknown>) => ViewElement;
};
const { renderToStaticMarkup } = (await import(viewRequire.resolve("react-dom/server"))) as {
  renderToStaticMarkup: (element: ViewElement) => string;
};
const { projectAssertion } = (await tsImport(`${insight}/attempt/model/assemble.ts`, viewModules)) as {
  projectAssertion: (document: unknown, locator: string) => AssertionView;
};
const { AssertionEvidence } = (await tsImport(
  `${insight}/components/primitives/assertion-evidence.tsx`,
  viewModules,
)) as { AssertionEvidence: unknown };

// How the Adapter classified the call. The core never derives this from the tool name or input.
type CommandClass =
  | { readonly kind: "not-command" }
  | { readonly kind: "unclassified" }
  | { readonly kind: "opaque"; readonly reason: "compound-shell" | "dynamic-shell" }
  | {
      readonly kind: "argv";
      readonly argv: readonly string[];
      /** Expected logical-command/v1 result for this argv. */
      readonly logical: readonly string[];
      readonly normalization: "identity" | "pnpm-exec" | "npx";
    };

interface ToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, string>>;
  readonly status: "completed" | "failed";
  readonly command: CommandClass;
}

function direct(...argv: string[]): CommandClass {
  return { kind: "argv", argv, logical: argv, normalization: "identity" };
}

// A single token longer than the 1 KiB argv preview, so the preview must stay bounded and the detail full.
const longToken = `--filter=${"数据".repeat(300)}`;
const pagedToken = `--filter=${"四页".repeat(50_000)}`;
const commands: readonly CommandClass[] = [
  direct("node", "--version"),
  direct("npm", "test"),
  direct("npm", "run", "lint", "--", "--fix"),
  direct("rm", "-rf", "dist dir"),
  { kind: "argv", argv: ["pnpm", "exec", "vitest", "run"], logical: ["vitest", "run"], normalization: "pnpm-exec" },
  { kind: "argv", argv: ["npx", "vitest", "run"], logical: ["vitest", "run"], normalization: "npx" },
  direct("npm", "test", longToken),
  direct("node", pagedToken),
  { kind: "opaque", reason: "compound-shell" },
  { kind: "unclassified" },
];

// Reduced counterexample from the user's Report: an ordinary tool followed by a shell command.
const reportedSequence: readonly ToolCall[] = [
  { name: "lookup_fixture", input: { id: "alpha" }, status: "completed", command: { kind: "not-command" } },
  { name: "bash", input: { command: "node --version" }, status: "completed", command: direct("node", "--version") },
];
// The same shell call from an Adapter that did not classify it must stay unclassified, not become a command.
const unclassifiedSequence: readonly ToolCall[] = [
  { name: "bash", input: { command: "pnpm test" }, status: "completed", command: { kind: "unclassified" } },
];
const toolCall: fc.Arbitrary<ToolCall> = fc.oneof(
  fc.record({
    name: fc.constantFrom("lookup_fixture", "read_file", "search_docs"),
    input: fc.record({ id: fc.constantFrom("alpha", "beta", "数据") }),
    status: fc.constantFrom("completed" as const, "failed" as const),
    command: fc.constant({ kind: "not-command" } as const),
  }),
  fc.record({
    name: fc.constantFrom("bash", "shell", "exec_command"),
    input: fc.constant({ command: "<shell source>" }),
    status: fc.constantFrom("completed" as const, "failed" as const),
    command: fc.constantFrom(...commands),
  }),
);
// One experiment run executes every generated sequence as its own Eval, so breadth costs one run.
const sequences = [
  reportedSequence,
  unclassifiedSequence,
  ...fc.sample(fc.array(toolCall, { minLength: 1, maxLength: 4 }), { numRuns: 4, seed: 20261128 }),
  // Every command class appears at least once regardless of the sampled sequences.
  commands.map((command, index): ToolCall => ({
    name: "bash",
    input: { command: `<shell ${index}>` },
    status: "completed",
    command,
  })),
];

const locales = ["zh-CN", "en"] as const;
interface RenderedAssertion {
  readonly sequence: readonly ToolCall[];
  readonly label: string;
  readonly locale: (typeof locales)[number];
  readonly html: string;
  readonly decision: string;
}
let cwd: string | undefined;
const rendered: RenderedAssertion[] = [];
interface ObservedToolCall {
  readonly call: ToolCall;
  readonly outline: unknown;
  readonly detail: unknown;
  readonly ledgerRows: readonly unknown[];
  readonly locator: string;
}
const observedCalls: ObservedToolCall[] = [];

beforeAll(async () => {
  cwd = await createJudgeProject("niceeval-report-tool-match-", {
    agent: `
      import {
        commandProjection,
        completeEvidenceCoverage,
        defineAgent,
        notCommandProjection,
        opaqueCommandProjection,
      } from "niceeval/adapter";
      // The fixture protocol states each call's classification explicitly, as a real Adapter would.
      function command(call) {
        switch (call.command.kind) {
          case "not-command": return { command: notCommandProjection() };
          case "opaque": return { command: opaqueCommandProjection(call.command.reason) };
          case "argv": {
            const [executable, ...args] = call.command.argv;
            return { command: commandProjection({ state: "available", executable, args }) };
          }
          default: return {};
        }
      }
      export default defineAgent({
        name: "tool-match-fixture",
        evidenceCoverage: completeEvidenceCoverage,
        send: async (input) => ({
          status: "completed",
          events: [
            ...JSON.parse(input.text).flatMap((call, index) => [
              { type: "operation.started", operationId: "op-" + index, operation: { kind: "tool", name: call.name, input: call.input, ...command(call) } },
              { type: "operation.finished", operationId: "op-" + index, kind: "tool", output: "out-" + index, status: call.status },
            ]),
            { type: "message", role: "assistant", text: "done" },
          ],
        }),
      });
    `,
    evals: Object.fromEntries(
      sequences.map((sequence, index) => [
        `tools-${index}.eval.ts`,
        `
        import { defineEval } from "niceeval";
        import { commandMatch, toolMatch } from "niceeval/expect";
        export default defineEval({ async test(t) {
          const turn = await t.send(${JSON.stringify(JSON.stringify(sequence))});
          turn.calledTool(commandMatch("npm", { argsStart: ["test"] })).label("command");
          turn.calledTool(toolMatch("lookup_fixture", { status: "failed" })).label("failed tool");
          turn.notCalledTool(toolMatch("read_file")).label("absent tool");
          ${sequence === reportedSequence ? 'turn.toolOrder([toolMatch("lookup_fixture"), toolMatch("read_file")]).label("failed order");' : ""}
        } });
      `,
      ]),
    ),
    experiments: {
      "tools.ts": `
        import { defineExperiment } from "niceeval";
        import agent from "../agent.ts";
        export default defineExperiment({ adapter: agent, evals: ${JSON.stringify(sequences.map((_, index) => `tools-${index}`))}, attempts: 1 });
      `,
    },
  });
  const { run } = await planAndRunExperiment(cwd, "tools", { config: { maxConcurrency: sequences.length } });
  for (const slot of run?.slots ?? []) {
    const publication = slot.publication;
    if (publication?.state !== "published") throw new Error("Expected a published Attempt");
    const evalIndex = Number(/tools-(\d+)/.exec(JSON.stringify(slot))?.[1]);
    const sequence = sequences[evalIndex];
    if (sequence === undefined) throw new Error("Expected the Attempt to name its tools Eval");
    const [traceDocument] = await showJsonDocuments(cwd, [publication.attemptLocator, "execution"]);
    const trace = narrowInspectionSuccess(traceDocument!, "attempt.trace");
    if (!trace.success) throw new Error(trace.reason);
    const toolCalls = trace.value.trace.conversation.items.filter((item) => item.kind === "tool-call");
    let commandLedger: readonly unknown[] = [];
    for (const item of await readAssertionsList(cwd, publication.attemptLocator)) {
      const { detail } = await readFullAssertionEntry(cwd, publication.attemptLocator, item.entryId);
      if (item.display.label === "command") commandLedger = toolLedgerRows(detail);
      const view = projectAssertion(detail, publication.attemptLocator);
      for (const locale of locales) {
        rendered.push({
          sequence,
          label: String(item.display.label),
          locale,
          decision: view.decision.result,
          html: renderToStaticMarkup(
            createElement(AssertionEvidence, {
              content: view.evidence,
              label: view.display.name,
              state: view.decision.result === "matched" ? "matched" : "mismatched",
              locale,
            }),
          ),
        });
      }
    }
    for (const [index, outline] of toolCalls.entries()) {
      const call = sequence[index];
      if (call === undefined) throw new Error("Expected a recorded call to match the fixture");
      const id = (outline as { toolOccurrenceId?: string }).toolOccurrenceId;
      if (id === undefined) throw new Error("Expected every tool call to carry its occurrence id");
      const [detailDocument] = await showJsonDocuments(cwd, [publication.attemptLocator, id]);
      const detail = narrowInspectionSuccess(detailDocument!, "attempt.trace.detail");
      if (!detail.success) throw new Error(detail.reason);
      observedCalls.push({
        call,
        outline,
        detail: detail.value.detail.kind === "tool-occurrence" ? detail.value.detail.call : undefined,
        ledgerRows: commandLedger.filter((row) => (row as { number?: string }).number === String(index + 1)),
        locator: publication.attemptLocator,
      });
    }
  }
}, 60_000);

// Test oracle for docs/feature/inspection/cli.md: POSIX single quotes for tokens that need them, 1 KiB preview.
function quoteToken(token: string): string {
  return token.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/u.test(token) ? token : `'${token.replaceAll("'", `'"'"'`)}'`;
}

function boundedArgv(argv: readonly string[]): { readonly preview: string; readonly omittedBytes: number } {
  const line = argv.map(quoteToken).join(" ");
  let preview = "";
  for (const character of line) {
    if (Buffer.byteLength(preview + character) > 1024) break;
    preview += character;
  }
  return { preview, omittedBytes: Buffer.byteLength(line) - Buffer.byteLength(preview) };
}

/** Tool rows of the final ledger in a full assertion detail, wherever the debugger places them. */
function toolLedgerRows(detail: unknown): unknown[] {
  const rows = new Map<string, unknown>();
  const visit = (value: unknown, path: readonly string[]) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.kind === "tool" && typeof record.rowId === "string" && !path.includes("atEvaluation")) {
      rows.set(record.rowId, record);
      return;
    }
    for (const [key, child] of Object.entries(record)) visit(child, [...path, key]);
  };
  visit(detail, []);
  return [...rows.values()];
}

afterAll(async () => {
  if (cwd !== undefined) await rm(cwd, { recursive: true, force: true });
});

function decode(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function visibleText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Inner HTML of every `tag` element (optionally carrying `className`), balanced by tag depth. */
function elements(html: string, tag: string, className?: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}(?=[\\s>])([^>]*)>`, "g");
  for (const match of html.matchAll(pattern)) {
    if (className !== undefined && !new RegExp(`class="(?:[^"]* )?${className}(?: [^"]*)?"`).test(match[1] ?? ""))
      continue;
    let depth = 1;
    const tags = new RegExp(`<(/?)${tag}(?=[\\s>])[^>]*>`, "g");
    tags.lastIndex = match.index + match[0].length;
    for (let next = tags.exec(html); next !== null; next = tags.exec(html)) {
      depth += next[1] === "/" ? -1 : 1;
      if (depth === 0) {
        found.push(html.slice(match.index + match[0].length, next.index));
        break;
      }
    }
  }
  return found;
}

function withoutRawData(html: string): string {
  let main = html;
  for (const raw of elements(html, "details", "niceeval-match-raw")) main = main.replace(raw, "");
  return main;
}

function ledgerRows(html: string): string[] {
  return [...elements(html, "details", "niceeval-filter-row"), ...elements(html, "div", "niceeval-filter-row")];
}

// @feature docs/feature/assertions/library/display.md#单条-assertion
test("tool ledger rows name each tool call by its human number, command argv and actual tool", () => {
  expect(rendered.length).toBe((sequences.length * 3 + 1) * locales.length);
  for (const entry of rendered) {
    const rows = ledgerRows(entry.html);
    expect(rows.length, `${entry.label} renders one ledger row per tool call`).toBe(entry.sequence.length);
    for (const row of rows) {
      const number = visibleText(elements(row, "span", "niceeval-filter-row-number")[0] ?? "");
      const summary = visibleText(elements(row, "strong")[0] ?? "");
      expect(number, "tool rows use the stable Tn number").toMatch(/ T\d+$/);
      const index = Number(/T(\d+)$/.exec(number)?.[1]) - 1;
      const call = entry.sequence[index];
      if (call === undefined) throw new Error("Expected the row to name one of the Eval's tool calls");
      const invocation = visibleText(elements(row, "span", "niceeval-filter-row-invocation")[0] ?? "");
      const zh = entry.locale === "zh-CN";
      if (call.command.kind === "argv") {
        const preview = boundedArgv(call.command.logical);
        expect(summary, "a usable command row is titled by its closed logical argv preview").toBe(preview.preview);
        expect(invocation, "the command row still names the actual tool").toContain(call.name);
        expect(invocation, "the command row names how it ran").toContain(
          call.command.normalization === "pnpm-exec"
            ? "pnpm exec"
            : call.command.normalization === "npx" ? "npx" : zh ? "原始 argv" : "direct argv",
        );
        if (preview.omittedBytes > 0) {
          expect(row).toMatch(/href="#\/attempt\/[^"]+\?aspect=execution&amp;id=ev_argv_tool_/u);
        }
      } else {
        expect(summary, "any other tool row is titled by the actual tool name").toBe(call.name);
        if (call.command.kind === "unclassified") {
          expect(invocation, "an unclassified call says so instead of passing for a command").toBe(
            zh ? "Adapter 未分类" : "unclassified by the Adapter",
          );
        }
        if (call.command.kind === "opaque") expect(invocation).toContain(call.command.reason);
      }
    }
  }
});

// @feature docs/feature/assertions/library/display.md#单条-assertion
test("filter comparisons show localized matcher fields with inline evidence instead of internal identities", () => {
  for (const entry of rendered) {
    if (entry.label === "failed order") continue;
    const main = withoutRawData(entry.html);
    const text = visibleText(main);
    expect(text, "internal snapshot markers never reach the reader").not.toContain("$niceeval");
    expect(text, "internal occurrence identities stay in technical locators").not.toMatch(/\btool_[a-z0-9]{10,}/);
    expect(text, "diagnostic trees are not flattened into one line").not.toMatch(/code: all-of/);
    const zh = entry.locale === "zh-CN";
    expect(
      ledgerRows(main).some((row) => elements(row, "section", "niceeval-filter-comparison").length > 0),
      `${entry.label} retains at least one representative comparison`,
    ).toBe(true);
    for (const row of ledgerRows(main)) {
      if (zh) {
        const details = visibleText(elements(row, "dl", "niceeval-filter-row-fields").join(" "));
        expect(details, "recorded tool facts use interface labels").toContain("名称");
        expect(details).not.toMatch(/\b(name|input|status|output)\b/);
      }
      const comparison = elements(row, "section", "niceeval-filter-comparison")[0];
      if (comparison === undefined) continue;
      const fields = elements(comparison, "div", "niceeval-match-children").flatMap((children) => [
        ...elements(children, "div", "niceeval-match-node"),
        ...elements(children, "details", "niceeval-match-node"),
      ]);
      const labels = fields.map((field) => visibleText(elements(field, "code")[0] ?? ""));
      expect(labels, `${entry.label} lists the matcher fields it checked`).toEqual(
        expect.arrayContaining(
          entry.label === "command"
            ? zh
              ? ["命令", "状态"]
              : ["command", "status"]
            : zh
              ? ["名称", "状态"]
              : ["name", "status"],
        ),
      );
      for (const field of fields) {
        expect(
          visibleText(elements(field, "span", "niceeval-match-state")[0] ?? ""),
          "every matcher field shows its state in text",
        ).not.toBe("");
      }
    }
  }
});

// @feature docs/feature/assertions/library/display.md#matcher-filter-debugger
test("the ledger exposes only supported filters and a failed order explains the checked suffix", () => {
  for (const locale of locales) {
    const zh = locale === "zh-CN";
    const complete = rendered.find((entry) => entry.sequence === reportedSequence && entry.label === "command" && entry.locale === locale);
    const partial = rendered.find((entry) => entry.sequence === sequences.at(-1) && entry.label === "absent tool" && entry.locale === locale);
    const order = rendered.find((entry) => entry.label === "failed order" && entry.locale === locale);
    if (complete === undefined || partial === undefined || order === undefined) throw new Error("Expected all debugger cases");
    const filterLabels = (html: string) =>
      elements(html, "select", "niceeval-filter-ledger-select").flatMap((select) =>
        elements(select, "option").map(visibleText),
      );
    expect(filterLabels(complete.html)).toEqual(zh ? ["全部记录", "命中", "未命中", "无法判断"] : ["All Records", "Match", "No match", "Unknown"]);
    expect(filterLabels(partial.html)).toEqual(zh ? ["全部记录", "已保留证据"] : ["All Records", "Retained Evidence"]);
    const frontier = visibleText(elements(order.html, "section", "niceeval-filter-frontier")[0] ?? "");
    expect(frontier).toContain(zh ? "失败边界" : "Failure frontier");
    expect(frontier).toContain("T1");
    expect(frontier).toContain(zh ? "检查 1 · 未命中 1 · 无法判断 0" : "1 checked · 1 mismatched · 0 unavailable");
  }
});

// @feature docs/feature/assertions/library/display.md#单条-assertion
test("every expandable control in assertion evidence reveals content", () => {
  for (const entry of rendered) {
    for (const body of elements(entry.html, "details")) {
      const afterSummary = body.slice(body.indexOf("</summary>") + "</summary>".length);
      expect(visibleText(afterSummary), `${entry.label} has no empty expansion`).not.toBe("");
    }
  }
});

// @feature docs/feature/assertions/library/display.md#单条-assertion
test("tool collection main view omits machine routing fields", () => {
  for (const entry of rendered) {
    const terms = elements(withoutRawData(entry.html), "dt").map(visibleText);
    expect(terms, entry.label).not.toContain("kind");
    expect(terms, entry.label).not.toContain("outcome");
  }
});

// @feature docs/feature/inspection/README.md#tool-command-readback
test("Inspection reads back each tool call's command classification with a bounded preview and full detail", () => {
  expect(observedCalls.length).toBe(sequences.reduce((count, sequence) => count + sequence.length, 0));
  const ledgerChecked = observedCalls.filter((call) => call.ledgerRows.length > 0).length;
  expect(ledgerChecked, "the commandMatch ledger carries every tool call").toBe(observedCalls.length);
  for (const observed of observedCalls) {
    const call = observed.call;
    const outline = (observed.outline as { command: unknown }).command;
    const detail = (observed.detail as { command: unknown }).command;
    const row = observed.ledgerRows[0] as { tool: string; command: unknown; summary: string };
    expect(row.tool, "ledger rows keep the actual tool name").toBe(call.name);
    expect(row.command, "the ledger row and the outline share one bounded projection").toEqual(outline);
    switch (call.command.kind) {
      case "not-command":
      case "unclassified":
        expect(outline).toEqual({ kind: call.command.kind });
        expect(detail).toEqual({ kind: call.command.kind });
        expect(row.summary).toBe(call.name);
        break;
      case "opaque":
        expect(outline).toEqual({ kind: "command", state: "opaque", reason: call.command.reason });
        expect(detail).toEqual(outline);
        break;
      case "argv": {
        const [executable, ...args] = call.command.logical;
        const preview = boundedArgv(call.command.logical);
        expect(outline).toMatchObject({
          kind: "command",
          state: "available",
          normalization: call.command.normalization,
          argv: preview,
        });
        expect(Buffer.byteLength(preview.preview)).toBeLessThanOrEqual(1024);
        if (!args.includes(pagedToken)) {
          expect(detail, "a short detail keeps every token beyond the preview").toEqual({
            kind: "command",
            state: "available",
            normalization: call.command.normalization,
            executable,
            args,
          });
        }
        expect(row.summary).toBe(preview.preview);
        break;
      }
    }
  }
  expect(
    observedCalls.some((call) => ((call.outline as { command: { argv?: { omittedBytes: number } } }).command.argv?.omittedBytes ?? 0) > 0),
    "the long argv exercises the preview bound",
  ).toBe(true);
});

// @feature docs/feature/inspection/README.md#tool-command-readback
test("a long tool argv stays out of the detail response and is recoverable through CLI evidence pages", async () => {
  const fixtureDirectory = cwd;
  if (fixtureDirectory === undefined) throw new Error("Expected a fixture directory");
  const observed = observedCalls.find(({ call }) => call.command.kind === "argv" && call.command.argv.includes(pagedToken));
  if (observed === undefined) throw new Error("Expected the long command occurrence");
  const detail = observed.detail as { command: { content?: { evidenceId: string; byteLength: number } } };
  const preview = observed.outline as { command: { argv: { evidenceId?: string } } };
  expect(Buffer.byteLength(JSON.stringify(detail.command))).toBeLessThan(16 * 1024);
  const content = detail.command.content;
  if (content === undefined) throw new Error("Expected the tool occurrence to link to paginated argv");
  expect(preview.command.argv.evidenceId).toBe(content.evidenceId);
  const argv = await readPaginatedTrace(fixtureDirectory, observed.locator, content.evidenceId);
  expect(argv.sha256).toBe(createHash("sha256").update(argv.bytes).digest("hex"));
  expect(argv.byteLength).toBe(content.byteLength);
  expect(argv.byteLength).toBeGreaterThan(256 * 1024);
  expect(JSON.parse(argv.bytes.toString("utf8"))).toEqual({
    state: "available",
    executable: "node",
    normalization: "identity",
    args: [pagedToken],
  });
});

// @feature docs/feature/adapters/README.md#tool-projection-and-privacy
test("commandMatch uses the classified argv and leaves shell input without a classification unavailable", () => {
  const commandResults = rendered.filter((entry) => entry.label === "command" && entry.locale === "en");
  expect(commandResults.find((entry) => entry.sequence === unclassifiedSequence)?.decision).toBe("unavailable");
  const withMatchingArgv = commandResults.filter(({ sequence }) =>
    sequence.some(({ command }) => command.kind === "argv" && command.logical[0] === "npm" && command.logical[1] === "test"),
  );
  expect(withMatchingArgv.length).toBeGreaterThan(0);
  for (const result of withMatchingArgv) expect(result.decision).toBe("matched");
});
