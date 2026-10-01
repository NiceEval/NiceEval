import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { deriveTestReference } from "concord-sdlc/model";
import { Effect, Result } from "effect";
import { test } from "vitest";

import { runPrBodyAt } from "./domain.ts";
import { makeNodePrLive } from "./node.ts";
import { readPrTestDeclarations } from "./test-relations.ts";

const nativePath = "e2e/fixture/test/native.test.ts";
const helperPath = "e2e/fixture/test/helper.scenarios.ts";
const caseId = deriveTestReference(nativePath, helperPath, "fixture contract");
const selector = `${nativePath}#${caseId}`;
const contract = "docs/feature/fixture/use-case/run.md";
const write = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const helperSource = `import { test } from "vitest";
// @use-case ${contract}
// @test-file ${nativePath}
test("fixture contract", () => {});
`;
const fixture = () => Effect.acquireRelease(
  Effect.sync(() => {
    const root = mkdtempSync(join(tmpdir(), "concord-pr-source-"));
    git(root, "init", "-q");
    git(root, "config", "user.name", "Concord fixture");
    git(root, "config", "user.email", "fixture@example.invalid");
    write(root, ".github/PULL_REQUEST_TEMPLATE.md", "## Problem\n\n## Tests\n");
    write(root, contract, "# Run\n\nPreserve the public result.\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "Fixture contracts");
    return root;
  }),
  root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

test.concurrent("PR source inventory reads the specified Git tree despite index and worktree changes", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* fixture();
  const head = yield* Effect.sync(() => {
    write(root, nativePath, 'import "./helper.scenarios.js";\n');
    write(root, helperPath, helperSource);
    git(root, "add", "e2e");
    git(root, "commit", "-qm", "Native owner and helper");
    const revision = git(root, "rev-parse", "HEAD");
    git(root, "rm", "--cached", helperPath);
    rmSync(join(root, helperPath));
    write(root, "e2e/fixture/test/new.test.ts", "// @use-case invalid\nconst unrelated = true;\n");
    git(root, "add", "e2e/fixture/test/new.test.ts");
    return revision;
  });
  const captured = yield* readPrTestDeclarations(root, selector, head).pipe(
    Effect.provide(makeNodePrLive(root)), Effect.provide(NodeServices.layer),
  );
  yield* Effect.sync(() => {
    assert.deepEqual(captured.inputFiles, [helperPath, nativePath]);
    assert.equal(captured.declarations.length, 1);
    assert.equal(captured.declarations[0]!.declarationPath, helperPath);
    assert.equal(captured.declarations[0]!.contract, contract);
  });
}))));

test.concurrent("local PR rendering includes untracked helper annotations and rejects ambiguous test declarations", () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* fixture();
  yield* Effect.sync(() => {
    write(root, nativePath, 'import "./helper.scenarios.js";\n');
    write(root, helperPath, helperSource);
    write(root, ".gitignore", "e2e/ignored/\n");
    write(root, "e2e/ignored/invalid.test.ts", "// @use-case invalid\nconst ignored = true;\n");
  });
  const source = ".git/concord-pr-draft.md";
  const rendered = yield* Effect.gen(function*() {
    yield* runPrBodyAt(root, { command: "init", source, base: "HEAD" });
    yield* runPrBodyAt(root, {
      command: "edit", operation: "test-set", source, selector,
      behavior: "Preserves the fixture result.", entry: "the installed public entry", assertion: "the declared result",
      escape: "a changed public result", fragmentFrom: [], fragmentThrough: [], sourceMode: "full",
    });
    return yield* runPrBodyAt(root, { command: "render", source });
  }).pipe(Effect.provide(makeNodePrLive(root)), Effect.provide(NodeServices.layer));
  yield* Effect.sync(() => {
    assert.equal(rendered._tag, "BodyRendered");
    if (rendered._tag === "BodyRendered") {
      assert.match(rendered.body, /fixture contract|helper\.scenarios/);
      assert.ok(rendered.body.includes(contract));
      assert.ok(rendered.body.includes(selector));
    }
    write(root, helperPath, helperSource + 'test("fixture contract", () => {});\n');
  });
  const duplicate = yield* Effect.result(readPrTestDeclarations(root, selector)).pipe(
    Effect.provide(makeNodePrLive(root)), Effect.provide(NodeServices.layer),
  );
  yield* Effect.sync(() => {
    assert.equal(Result.isFailure(duplicate), true);
    if (Result.isFailure(duplicate)) assert.equal(duplicate.failure._tag, "PrTestRelationInvalid");
  });
}))));
