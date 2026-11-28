import fc from "fast-check";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createJudgeProject,
  planAndRunExperiment,
  readAssertionsList,
  readFullAssertionEntry,
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
  projectAssertion: (document: unknown) => AssertionView;
};
const { AssertionEvidence } = (await tsImport(
  `${insight}/components/primitives/assertion-evidence.tsx`,
  viewModules,
)) as { AssertionEvidence: unknown };

interface ToolCall {
  readonly name: string;
  readonly input: Readonly<Record<string, string>>;
  readonly status: "completed" | "failed";
}

// Reduced counterexample from the user's Report: an ordinary tool followed by a shell command.
const reportedSequence: readonly ToolCall[] = [
  { name: "lookup_fixture", input: { id: "alpha" }, status: "completed" },
  { name: "bash", input: { command: "node --version" }, status: "completed" },
];
const toolCall: fc.Arbitrary<ToolCall> = fc.oneof(
  fc.record({
    name: fc.constantFrom("lookup_fixture", "read_file", "search_docs"),
    input: fc.record({ id: fc.constantFrom("alpha", "beta", "数据") }),
    status: fc.constantFrom("completed" as const, "failed" as const),
  }),
  fc.record({
    name: fc.constantFrom("bash", "shell", "exec_command"),
    input: fc.record({ command: fc.constantFrom("node --version", "pnpm test", "pnpm lint --fix", "rm -rf dist") }),
    status: fc.constantFrom("completed" as const, "failed" as const),
  }),
);
// One experiment run executes every generated sequence as its own Eval, so breadth costs one run.
const sequences = [
  reportedSequence,
  ...fc.sample(fc.array(toolCall, { minLength: 1, maxLength: 4 }), { numRuns: 3, seed: 20261128 }),
];

const locales = ["zh-CN", "en"] as const;
interface RenderedAssertion {
  readonly sequence: readonly ToolCall[];
  readonly label: string;
  readonly locale: (typeof locales)[number];
  readonly html: string;
}
let cwd: string | undefined;
const rendered: RenderedAssertion[] = [];

beforeAll(async () => {
  cwd = await createJudgeProject("niceeval-report-tool-match-", {
    agent: `
      import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
      export default defineAgent({
        name: "tool-match-fixture",
        evidenceCoverage: completeEvidenceCoverage,
        send: async (input) => ({
          status: "completed",
          events: [
            ...JSON.parse(input.text).flatMap((call, index) => [
              { type: "operation.started", operationId: "op-" + index, operation: { kind: "tool", name: call.name, input: call.input } },
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
          turn.calledTool(commandMatch("pnpm", { argsStart: ["test"] })).label("command");
          turn.calledTool(toolMatch("lookup_fixture", { status: "failed" })).label("failed tool");
          turn.notCalledTool(toolMatch("read_file")).label("absent tool");
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
    for (const item of await readAssertionsList(cwd, publication.attemptLocator)) {
      const { detail } = await readFullAssertionEntry(cwd, publication.attemptLocator, item.entryId);
      const view = projectAssertion(detail);
      for (const locale of locales) {
        rendered.push({
          sequence,
          label: String(item.display.label),
          locale,
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
  }
}, 60_000);

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
test("tool ledger rows name each tool call by its human number and actual tool", () => {
  expect(rendered.length).toBe(sequences.length * 3 * locales.length);
  for (const entry of rendered) {
    const rows = ledgerRows(entry.html);
    expect(rows.length, `${entry.label} renders one ledger row per tool call`).toBe(entry.sequence.length);
    for (const row of rows) {
      const number = visibleText(elements(row, "span", "niceeval-filter-row-number")[0] ?? "");
      const summary = visibleText(elements(row, "strong")[0] ?? "");
      expect(number, "tool rows use the stable Tn number").toMatch(/ T\d+$/);
      const index = Number(/T(\d+)$/.exec(number)?.[1]) - 1;
      expect(summary, "the row title is the actual tool name").toBe(entry.sequence[index]?.name);
    }
  }
});

// @feature docs/feature/assertions/library/display.md#单条-assertion
test("filter comparisons show localized matcher fields with inline evidence instead of internal identities", () => {
  for (const entry of rendered) {
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
