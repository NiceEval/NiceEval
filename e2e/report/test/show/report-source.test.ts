// owner: e2e/report show --source closed loop (text + niceeval.show JSON)
// rerun: pnpm e2e --repo report -- --run test/show/report-source.test.ts

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PINNED_ENV } from "../support/context.ts";
import { assertPublicShowJson } from "../support/show-json.ts";
import { withClassicWorld } from "../support/world.ts";

interface SourceLine {
  readonly text: string;
  readonly calls: readonly { readonly target?: { readonly kind?: string; readonly node?: SourceNode } }[];
}

interface SourceNode {
  readonly file: string;
  readonly lines: readonly SourceLine[];
}

test("show --source keeps captured BEFORE content after the private copy source is rewritten", async () => {
  await withClassicWorld("show-source", async ({ paths: { projectRoot }, commands: { niceeval }, world }) => {
    const locator = world.attemptLocator("classic/baseline", "source-snapshot");
    const entryPath = join(projectRoot, "evals", "source-snapshot.eval.ts");
    const assertionPath = join(projectRoot, "evals", "source-snapshot", "assertions.ts");
    const entry = await readFile(entryPath, "utf8");
    const assertions = await readFile(assertionPath, "utf8");
    expect(entry).toContain("ENTRY_SNAPSHOT_BEFORE");
    expect(assertions).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
    await writeFile(entryPath, entry.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"), "utf8");
    await writeFile(
      assertionPath,
      assertions.replace("IMPORTED_ASSERTION_SNAPSHOT_BEFORE", "IMPORTED_ASSERTION_SNAPSHOT_AFTER"),
      "utf8",
    );

    const shown = await niceeval.run(["show", locator, "--source=full"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expectSourceTextBlock(shown.stdout, {
      header: "evals/source-snapshot.eval.ts",
      content: 'const ENTRY_SNAPSHOT = "ENTRY_SNAPSHOT_BEFORE";',
    });
    expectSourceTextBlock(shown.stdout, {
      header: "  │ evals/source-snapshot/assertions.ts",
      content: 'const snapshot = "IMPORTED_ASSERTION_SNAPSHOT_BEFORE";',
    });
    expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
    expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");

    const json = await niceeval.run(["show", locator, "--source", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("source");
    const source = (document.data as { readonly source?: { readonly spine?: SourceNode } }).source;
    expect(source?.spine?.file, "report.source.spine.path").toBe("evals/source-snapshot.eval.ts");
    expect(sourceLine(source!.spine!, 'const ENTRY_SNAPSHOT = "ENTRY_SNAPSHOT_BEFORE";'), "report.source.spine.content").toBe(
      true,
    );
    const imported = sourceNodes(source!.spine!).filter(
      (node) => node.file === "evals/source-snapshot/assertions.ts",
    );
    expect(imported, "report.source.imported.path").toHaveLength(1);
    expect(
      sourceLine(imported[0]!, 'const snapshot = "IMPORTED_ASSERTION_SNAPSHOT_BEFORE";'),
      "report.source.imported.content",
    ).toBe(true);
    expect(sourceNodes(source!.spine!).flatMap((node) => node.lines.map((line) => line.text))).not.toContain(
      'const ENTRY_SNAPSHOT = "ENTRY_SNAPSHOT_AFTER";',
    );
    expect(sourceNodes(source!.spine!).flatMap((node) => node.lines.map((line) => line.text))).not.toContain(
      'const snapshot = "IMPORTED_ASSERTION_SNAPSHOT_AFTER";',
    );
  });
});

function expectSourceTextBlock(stdout: string, expected: { readonly header: string; readonly content: string }): void {
  const lines = stdout.replace(/\r\n?/g, "\n").split("\n");
  const headers = lines.flatMap((line, index) => (line === expected.header ? [index] : []));
  expect(headers, `report.source.text[${expected.header}].header`).toHaveLength(1);
  const start = headers[0]! + 1;
  const relativeEnd = lines.slice(start).findIndex((line) =>
    expected.header.startsWith("  │ ") ? !line.startsWith("  │") : line.startsWith("  ↳ "),
  );
  const block = lines.slice(start, relativeEnd < 0 ? lines.length : start + relativeEnd);
  expect(
    block.filter((line) => line.includes(expected.content)),
    `report.source.text[${expected.header}].content`,
  ).toHaveLength(1);
}

function sourceNodes(root: SourceNode): readonly SourceNode[] {
  return [
    root,
    ...root.lines.flatMap((line) =>
      line.calls.flatMap((call) => (call.target?.kind === "source" && call.target.node !== undefined ? sourceNodes(call.target.node) : [])),
    ),
  ];
}

function sourceLine(node: SourceNode, expected: string): boolean {
  return node.lines.filter((line) => line.text.trim() === expected).length === 1;
}
