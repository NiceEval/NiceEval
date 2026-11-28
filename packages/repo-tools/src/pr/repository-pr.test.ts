import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Result } from "effect";
import fc from "fast-check";
import { test } from "vitest";

import { makeNodePrLive, PrGitHub, runPrBodyAt } from "./index.ts";
import { readPrTestDeclarations } from "./test-relations.ts";
import { readConcordTestList } from "../concord-cli.ts";

const nativePath = "e2e/fixture/test/native.test.ts";
const helperPath = "e2e/fixture/test/helper.scenarios.ts";
const fixtureSelector = (root: string) =>
  readConcordTestList(root).pipe(
    Effect.flatMap((cases) => {
      const selected = cases.filter((item) => item.file === helperPath);
      return selected.length === 1
        ? Effect.succeed(`${selected[0]!.file}#${selected[0]!.id}`)
        : Effect.die(new Error("Fixture must expose exactly one public marker case"));
    }),
    Effect.provide(NodeServices.layer),
  );
const contract = "docs/feature/fixture/use-case/run.md";
const issue = "docs/issues/fixture.md";
const write = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const git = (root: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const docsProblem = {
  command: "edit",
  operation: "problem",
  userGoal: "docs",
  currentLimitation: "wording",
  requiredCapability: "clarity",
  userOutcome: "docs",
};
const helperSource = `import { test } from "vitest";
// @use-case ${contract}
// @issue ${issue}
test("fixture contract", () => {});
`;
const fixtureRepository = (prepare?: (root: string) => void) =>
  Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(realpathSync(tmpdir()), "concord-pr-source-"))),
    (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
  ).pipe(
    Effect.tap((root) =>
      Effect.sync(() => {
        git(root, "init", "-q");
        git(root, "config", "user.name", "Concord fixture");
        git(root, "config", "user.email", "fixture@example.invalid");
        write(root, ".github/PULL_REQUEST_TEMPLATE.md", "## Problem\n\n## Tests\n");
        prepare?.(root);
        git(root, "add", ".");
        git(root, "commit", "-qm", "Fixture contracts");
      }),
    ),
  );

const fixture = () =>
  fixtureRepository((root) => {
    execFileSync("concord", ["--root", root, "--json", "init", "--test-root", "e2e", "--yes"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    write(root, contract, "# Run\n\nPreserve the public result.\n");
    write(root, "docs/feature/fixture/README.md", "# Fixture\n");
    write(
      root,
      issue,
      "---\nrelations:\n  - role: spec\n    target: docs/feature/fixture/use-case/run.md\n---\n# Fixture Issue\n",
    );
    write(
      root,
      "concord.config.ts",
      'export default { testRoots: ["e2e"], sourceRoots: [], sourceIgnore: ["e2e/ignored"] } as const;\n',
    );
  });

test("a numbered check explains how to reuse a custom create source", ({ signal }) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* fixtureRepository();
        const head = git(root, "rev-parse", "HEAD");
        const branch = git(root, "branch", "--show-current");
        const repository = "fixture/niceeval";
        const pr = 101;
        const url = `https://github.com/${repository}/pull/${pr}`;
        git(root, "remote", "add", "origin", `https://github.com/${repository}.git`);
        git(root, "update-ref", "refs/remotes/origin/main", head);
        git(root, "update-ref", "refs/remotes/origin/pr-body-fixture", head);
        git(root, "branch", "--set-upstream-to=origin/pr-body-fixture", branch);
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(fc.constantFrom("draft.md", "draft with spaces.md", "nested/draft.md"), async (name) => {
              const source = `.git/custom-pr-body/${name}`;
              rmSync(join(root, source), { force: true });
              let body = "";
              const run = (input: unknown) =>
                runPrBodyAt(root, input).pipe(
                  Effect.provideService(PrGitHub, {
                    repository: () => Effect.succeed(repository),
                    create: ({ bodyFile }) =>
                      Effect.sync(() => {
                        body = readFileSync(bodyFile, "utf8");
                        return url;
                      }),
                    edit: (_pr, bodyFile) =>
                      Effect.sync(() => {
                        body = readFileSync(bodyFile, "utf8");
                      }),
                    view: () =>
                      Effect.sync(() => ({
                        body,
                        headRefOid: head,
                        headRepository: repository,
                        baseRefOid: head,
                        baseRefName: "main",
                        baseRepository: repository,
                      })),
                  }),
                  Effect.provide(makeNodePrLive(root)),
                  Effect.provide(NodeServices.layer),
                );
              await Effect.runPromise(
                Effect.gen(function* () {
                  yield* run({ command: "init", source, base: "HEAD" });
                  yield* run({ ...docsProblem, source });
                  const created = yield* run({ command: "create", source, base: "main", title: "Clarify docs" });
                  assert.equal(created._tag, "PullRequestCreated");
                  const explicit = yield* run({ command: "check", pr, source, remote: true });
                  assert.equal(explicit._tag, "BodyChecked");
                  const implicit = yield* Effect.result(run({ command: "check", pr, remote: true }));
                  assert.ok(Result.isFailure(implicit) && implicit.failure._tag === "PrDraftInvalid");
                  assert.match(implicit.failure.message, /check --pr 101 --source <draft-path> --remote/);
                }),
                { signal },
              );
            }),
            { examples: [["draft.md"]], numRuns: 6 },
          ),
        );
      }),
    ),
    { signal },
  ));

test("a verification receipt passes local check without a test source", ({ signal }) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* fixtureRepository();
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(
              fc.constantFrom("pnpm lint passed", "pnpm typecheck passed"),
              fc.constantFrom("0", "not applicable — no Unit changed"),
              async (green, unitCount) => {
                const source = ".git/docs-only.md";
                rmSync(join(root, source), { force: true });
                await Effect.runPromise(
                  Effect.gen(function* () {
                    yield* runPrBodyAt(root, { command: "init", source, base: "HEAD" });
                    yield* runPrBodyAt(root, { ...docsProblem, source });
                    yield* runPrBodyAt(root, {
                      command: "edit",
                      operation: "verification",
                      source,
                      candidate: "docs-only",
                      green,
                      repeatability: "not applicable",
                      fixedConditions: "docs-only",
                      unitCount,
                    });
                    const checked = yield* runPrBodyAt(root, { command: "check", source });
                    assert.equal(checked._tag, "BodyChecked");
                    const rendered = yield* runPrBodyAt(root, { command: "render", source });
                    assert.equal(rendered._tag, "BodyRendered");
                    assert.ok(
                      rendered.body.includes(`### Verification receipt\n\n- Candidate: docs-only\n- Green: ${green}\n`),
                    );
                    assert.ok(rendered.body.includes(`- Unit count: ${unitCount}\n`));
                  }).pipe(Effect.provide(makeNodePrLive(root)), Effect.provide(NodeServices.layer)),
                  { signal },
                );
              },
            ),
            { examples: [["pnpm lint passed", "0"]], numRuns: 6 },
          ),
        );
      }),
    ),
    { signal },
  ));

test.concurrent(
  "PR source inventory reads the specified Git tree despite index and worktree changes",
  ({ signal }) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* fixture();
          const head = yield* Effect.sync(() => {
            write(root, nativePath, 'import "./helper.scenarios.js";\n');
            write(root, helperPath, helperSource);
            git(root, "add", "e2e");
            git(root, "commit", "-qm", "Native owner and helper");
            const revision = git(root, "rev-parse", "HEAD");
            return revision;
          });
          const selector = yield* fixtureSelector(root);
          yield* Effect.sync(() => {
            git(root, "rm", "--cached", helperPath);
            rmSync(join(root, helperPath));
            write(root, "e2e/fixture/test/new.test.ts", "// @use-case invalid\nconst unrelated = true;\n");
            git(root, "add", "e2e/fixture/test/new.test.ts");
          });
          const captured = yield* readPrTestDeclarations(root, selector, head).pipe(
            Effect.provide(makeNodePrLive(root)),
            Effect.provide(NodeServices.layer),
          );
          yield* Effect.sync(() => {
            assert.deepEqual(captured.inputFiles, [helperPath, nativePath]);
            assert.equal(captured.declarations.length, 1);
            assert.equal(captured.declarations[0]!.declarationPath, helperPath);
            assert.equal(captured.declarations[0]!.contract, contract);
            assert.deepEqual(captured.declarations[0]!.issues, [issue]);
          });
        }),
      ),
      { signal },
    ),
  60_000,
);

test.concurrent(
  "local PR rendering includes untracked marker declarations and rejects invalid contract markers",
  ({ signal }) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* fixture();
          yield* Effect.sync(() => {
            write(root, nativePath, 'import "./helper.scenarios.js";\n');
            write(root, helperPath, helperSource);
            write(root, ".gitignore", "e2e/ignored/\n");
            write(root, "e2e/ignored/invalid.test.ts", "// @use-case invalid\nconst ignored = true;\n");
          });
          const selector = yield* fixtureSelector(root);
          const source = ".git/concord-pr-draft.md";
          const rendered = yield* Effect.gen(function* () {
            yield* runPrBodyAt(root, { command: "init", source, base: "HEAD" });
            yield* runPrBodyAt(root, {
              command: "edit",
              operation: "test-set",
              source,
              selector,
              behavior: "Preserves the fixture result.",
              entry: "the installed public entry",
              assertion: "the declared result",
              escape: "a changed public result",
              issue,
              fragmentFrom: [],
              fragmentThrough: [],
              sourceMode: "full",
            });
            return yield* runPrBodyAt(root, { command: "render", source });
          }).pipe(Effect.provide(makeNodePrLive(root)), Effect.provide(NodeServices.layer));
          yield* Effect.sync(() => {
            assert.equal(rendered._tag, "BodyRendered");
            if (rendered._tag === "BodyRendered") {
              assert.match(rendered.body, /fixture contract|helper\.scenarios/);
              assert.ok(rendered.body.includes(contract));
              assert.ok(rendered.body.includes(selector));
              assert.ok(rendered.body.includes(`Issue [${issue}]`));
            }
            write(root, helperPath, helperSource + "// @use-case invalid\n");
          });
          const duplicate = yield* Effect.result(readPrTestDeclarations(root, selector)).pipe(
            Effect.provide(makeNodePrLive(root)),
            Effect.provide(NodeServices.layer),
          );
          yield* Effect.sync(() => {
            assert.equal(Result.isFailure(duplicate), true);
            if (Result.isFailure(duplicate)) assert.equal(duplicate.failure._tag, "PrTestRelationInvalid");
          });
        }),
      ),
      { signal },
    ),
  60_000,
);
