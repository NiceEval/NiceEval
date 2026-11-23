import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { selectTakeoverOwners, shardTakeoverCells } from "./e2e-takeover.ts";

function gitFixture() {
  const root = mkdtempSync(join(tmpdir(), "takeover-selection-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const put = (file, value) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), value); };
  const commit = () => { git("add", "."); git("-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  git("init", "-q");
  return { root, git, put, commit };
}

test("Git diff selection keeps deterministic Concord identities, ignores formatting, and covers shared fixture changes", () => {
  const { root, git, put, commit } = gitFixture();
  const owner = (file, suffix) => ({ file, id: `neref_${suffix.repeat(32)}`, status: "active" });
  const a = owner("e2e/demo/test/a.test.ts", "a"), b = owner("e2e/demo/test/b.test.ts", "b"), live = owner("e2e/adapter/live/test/live.test.ts", "c");
  const plan = { cells: [{ id: "mixed", repoIds: ["demo", "adapter/live"], dirs: ["demo", "adapter/live"] }] };
  const cases = [a, b, live, { ...a, id: `neref_${"d".repeat(32)}`, status: "retired" }];
  try {
    put("e2e/demo/project.json", JSON.stringify({ targets: { e2e: { metadata: { niceeval: {} } } } }));
    put("e2e/adapter/live/project.json", JSON.stringify({ targets: { e2e: { metadata: { niceeval: { requires: { externalNetwork: true } } } } } }));
    for (const entry of [a, b, live]) put(entry.file, 'test("result", () => expect(1).toBe(1));\n');
    put("e2e/demo/fixture.txt", "first");
    let base = commit();
    const select = () => selectTakeoverOwners({ root, base, head: "HEAD", plan, cases });
    put(a.file, '// editorial comment\ntest( "result", () => expect(1).toBe(1) );\n');
    commit();
    assert.deepEqual(select().cells, [], "formatting and comments do not retake an owner");
    base = git("rev-parse", "HEAD");
    put(a.file, 'test("result", () => expect(2).toBe(2));\n');
    put(live.file, 'test("live", () => expect(2).toBe(2));\n');
    commit();
    assert.deepEqual(select().cells[0].owners, [{ repo: "demo", selector: `${a.file}#${a.id}` }]);
    base = git("rev-parse", "HEAD");
    put("e2e/demo/fixture.txt", "second");
    commit();
    assert.deepEqual(select().cells.flatMap(cell => cell.owners), [a, b].map(({ file, id }) => ({ repo: "demo", selector: `${file}#${id}` })), "shared input change retakes both active deterministic owners");
    assert.deepEqual(selectTakeoverOwners({ root, base, head: "HEAD", plan: { cells: [] }, cases }).cells, []);
    assert.throws(() => selectTakeoverOwners({ root, base, head: base, plan, cases }), /checkout HEAD/);
    base = git("rev-parse", "HEAD");
    const added = owner("e2e/demo/test/new.test.ts", "e");
    put(added.file, 'test("new result", () => expect(3).toBe(3));\n');
    cases.push(added);
    commit();
    assert.deepEqual(select().cells[0].owners, [{ repo: "demo", selector: `${added.file}#${added.id}` }], "new owner is selected without unchanged siblings");
    base = "0".repeat(40);
    assert.equal(select().cells.flatMap(cell => cell.owners).length, 3, "initial push compares against the empty tree");
    base = git("rev-parse", "HEAD");
    git("rm", a.file);
    commit();
    cases.splice(cases.indexOf(a), 1);
    assert.deepEqual(select().cells, [], "deleted owners are not passed to takeover");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a budget bump, a changed owner and the private Codex image retake exactly the two affected cases", () => {
  const { root, put, commit } = gitFixture();
  const repo = "runner";
  const prefix = "e2e/runner/";
  const file = prefix + "test/codex-login-patch.test.ts";
  const imageCase = { file, id: "neref_50a12241c29342f0aa71197821ad3b3c", status: "active" };
  const otherCase = { file, id: "neref_41e30c38ff33991e64370449688f372a", status: "active" };
  const identity = { file: prefix + "test/agent-install-identity.test.ts", id: "neref_7abe9d8e5498b5486a7322eeb86452db", status: "active" };
  const unrelated = { file: prefix + "test/unrelated.test.ts", id: `neref_${"d".repeat(32)}`, status: "active" };
  const cases = [identity, imageCase, otherCase, unrelated];
  const plan = { cells: [{ id: "repo-batch-docker-4", repoIds: [repo], dirs: [repo] }] };
  const manifest = (timeoutMinutes, command = ["vitest", "run"]) =>
    put(prefix + "project.json", JSON.stringify({ targets: { e2e: { metadata: { niceeval: { timeoutMinutes, command } } } } }));
  const dockerfile = prefix + "fixtures/codex-npm/Dockerfile";
  const selected = (base, active = cases) => selectTakeoverOwners({ root, base, head: "HEAD", plan, cases: active })
    .cells.flatMap(cell => cell.owners.map(owner => owner.selector));
  const selector = owner => owner.file + "#" + owner.id;
  try {
    manifest(10);
    put(file, 'test("login", login); it.each(images)("repair", repair);');
    put(identity.file, 'expect(version).toBe("0.167.2");');
    put(unrelated.file, 'test("unrelated", check);');
    put(dockerfile, "RUN npm install -g @openai/codex@0.167.2");
    const before = commit();
    manifest(20);
    const budgetBump = commit();
    put(identity.file, 'expect(version).toBe("0.171.0");');
    put(dockerfile, "RUN npm install -g @openai/codex@0.171.0");
    const upgrade = commit();
    assert.deepEqual(selected(before), [selector(identity), selector(imageCase)], "three-file counterexample");
    assert.deepEqual(selected(budgetBump), [selector(identity), selector(imageCase)], "actual push after the budget bump");
    assert.deepEqual(selected(budgetBump, [identity, otherCase]), [selector(identity), selector(otherCase)], "unresolved fixture ownership falls back to the repo");
    manifest(30);
    const largerBudget = commit();
    assert.deepEqual(selected(upgrade), [], "changing only the deadline");
    manifest(30, ["another-test-command"]);
    commit();
    assert.deepEqual(selected(largerBudget), cases.map(selector).sort(), "a changed execution command affects all owners");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("takeover shards keep every owner on its original placement within the GitHub matrix limit", () => {
  const docker = { id: "docker", owners: Array.from({ length: 255 }, (_, i) => ({ repo: "runner", selector: String(i) })) };
  for (const [browserOwnerCount, expectedJobs] of [[1, 256], [2, 129]]) {
    const browser = { id: "browser", owners: Array.from({ length: browserOwnerCount }, (_, i) => ({ repo: "view", selector: String(i) })) };
    const cells = [docker, browser];
    const shards = shardTakeoverCells(cells);
    assert.equal(shards.length, expectedJobs);
    assert.equal(new Set(shards.map(shard => shard.id)).size, shards.length);
    for (const cell of cells) {
      assert.deepEqual(shards.filter(shard => shard.sourceCellId === cell.id).flatMap(shard => shard.owners), cell.owners);
    }
  }
});
