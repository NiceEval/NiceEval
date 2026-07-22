// 读取面 CLI 行为 domain(docs/engineering/testing/e2e/report.md §4 —— plan/testing-layer-realignment.md
// B2):show / view 在真实 Results 上的可观察行为——选择与收窄、历史与多页、证据切面、Scope
// 警告、导出与本地 server。和 scripts/verify-format.ts 一样消费 scripts/evidence.ts 产出的
// Evidence 对象,但本模块不在 CLI-black-box 规则(README §4.2)的豁免范围内——不同于
// verify-format.ts(第 1 点豁免:format 本身就是被测对象),本 domain 从不 import niceeval
// 库代码去读取结果,也从不扫描 `.niceeval/` 内部结构。下面每一条断言都只走以下几种路径之一:
//   - `pnpm exec niceeval ...` 的 stdout/退出码(唯一被认可的读取路径),或者
//   - 对某个 CLI 输出目录的普通 fs 读取(`view --out` 的站点目录,或者 Evidence 已经产出的
//     siteExportDir)——这是一份有文档记录、稳定的 CLI 输出契约
//     (docs/feature/reports/view.md「静态导出」),不是 `.niceeval/` 内部结构,或者
//   - 对本模块自己启动并杀掉的 `niceeval view` 本地 server 发起真实 HTTP 请求。
//
// report.md §4 五条要点里有两条(partial-coverage / stale-snapshot / unreadable-snapshot 这三种
// Scope 警告,以及"无 phases"的 timing 场景)在本仓库这份 3-Experiment 的证据里不会自然出现,
// 而想让它们出现又会打扰其他 domain 在共享 resultsRoot 上的断言。为此本模块手写了一份最小的、
// 独立的 Results 格式 fixture(下面的 buildScopeWarningsFixture)——按
// docs/feature/results/architecture.md 的 schema 手写的纯 JSON 字面量,写到它自己的 scratch
// 目录里,只通过 `niceeval show/view --results <scratch>` 读回——绝不触碰
// Evidence.resultsRoot(docs/engineering/testing/e2e/report.md 的 B2 任务,「重要操作提示」#2)。
//
// "历史与多页"需要共享 Evidence 不会产出的第二份真实快照(produceEvidence() 每个 Experiment
// 只运行一次),所以本模块额外发起两次真实的 `niceeval exp main` 调用:一次带 `--force`
// (真实网关小额开销,B2 任务已批准)拿到第二份快照,一次不带 `--force`(免费——走
// carry-forward 复用路径)来证明 `--history` 的跨快照去重确实把重复项折叠掉了,而不是简单地把
// 看到的一切都合并进来。

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import assert from "node:assert/strict";
import { InfraError } from "./evidence.ts";
import { sh } from "./sh.ts";
import type { Evidence } from "./evidence.ts";

const PROVIDER_FAULT_RE = /errored.*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/i;

/** 和 scripts/evidence.ts 的 shExpectZero 遵循同样的真实网关调用约定——本模块发起的这一次额外
 * 真实调用(verifyHistoryAndPages 里的 --force 重跑)享有同样的 infra/回归 分类规则。 */
function shExpectZero(cmd: string): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  if (exit === 0) return res.stdout;
  const combined = `${res.stdout}\n${res.stderr}`;
  if (PROVIDER_FAULT_RE.test(combined)) {
    throw new InfraError(`${cmd} exited ${exit} with a provider-side fault visible in --output ci text:\n${combined.slice(-3000)}`);
  }
  throw new Error(`${cmd}\nexited ${exit}, expected 0. stdout/stderr tail:\n${combined.slice(-3000)}`);
}

/** 用于那些预期会以某条特定消息失败的命令——返回 {stdout,stderr,combined,status} 而不是抛出异常,
 * 因为这里的断言本身就是"它以这种特定方式失败了"。niceeval 的 CLI 会把用法/无匹配错误写到
 * stderr,把正常的报告输出写到 stdout(下面每个调用点都做过实测验证)——除非调用方在意具体是
 * 哪个流,否则都应该匹配 `combined`。 */
function shRaw(cmd: string): { stdout: string; stderr: string; combined: string; status: number } {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { stdout, stderr, combined: `${stdout}\n${stderr}`, status: res.status ?? -1 };
}

// ---------------------------------------------------------------------------
// 本地 `niceeval view` server 的生命周期——由本模块自己负责
// (延续 docs/engineering/testing/e2e/README.md「被测服务由仓库的 scripts/e2e.ts 启动和清理」的
// 精神,应用到这里的 verify-domain 这一层,因为本仓库自己没有长期存活的 service)。
// ---------------------------------------------------------------------------

interface ViewServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

/** 启动 `pnpm exec niceeval view --no-open <extraArgs>`,等待打印出的 URL(= 就绪信号),
 * 返回一个带 `stop()` 方法的句柄,`stop()` 会终止整个进程组。如果 20 秒内没有出现 URL,或者
 * 进程提前退出(例如零可读结果的场景——想要这种结果的调用方应该改用 `expectServerDoesNotStart`),
 * 则 reject。 */
function startViewServer(extraArgs: string[]): Promise<ViewServer> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("pnpm", ["exec", "niceeval", "view", "--no-open", ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let buffered = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* 进程已经不在了 */ }
      reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} printed no URL within 20s. Output so far:\n${buffered}`));
    }, 20_000);

    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = buffered.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        const baseUrl = `http://127.0.0.1:${match[1]}`;
        resolvePromise({
          baseUrl,
          stop: () =>
            new Promise<void>((res) => {
              proc.once("exit", () => res());
              try { process.kill(-proc.pid!, "SIGTERM"); } catch { res(); }
              setTimeout(() => { try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* 进程已经不在了 */ } }, 3000);
            }),
        });
      }
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} exited (code ${code}) before printing a URL. Output:\n${buffered}`));
    });
  });
}

/** 用于零可读结果的场景:断言进程会在一个较短的时间窗口内以非零码退出,且期间从未打印过
 * server URL——这是 Scope 警告这一条里"view 不启动 server"那一半的验证。 */
function expectServerDoesNotStart(extraArgs: string[]): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("pnpm", ["exec", "niceeval", "view", "--no-open", ...extraArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let buffered = "";
    const timer = setTimeout(() => {
      try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* 进程已经不在了 */ }
      reject(new Error(`expected niceeval view --no-open ${extraArgs.join(" ")} to exit immediately (zero readable results), but it was still running (and printed no URL) after 10s:\n${buffered}`));
    }, 10_000);
    const onData = (chunk: Buffer) => { buffered += chunk.toString(); };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (/http:\/\/127\.0\.0\.1:\d+\//.test(buffered)) {
        reject(new Error(`niceeval view --no-open ${extraArgs.join(" ")} printed a server URL despite zero readable results:\n${buffered}`));
        return;
      }
      resolvePromise({ exitCode: code, output: buffered });
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 手写的最小 Results 格式 fixture(遵循 docs/feature/results/architecture.md 的 schema)——
// 用来演示在本仓库真实证据中不会自然出现的那几种 Scope 警告,以及"无 phases → unavailable"
// 场景。`schemaVersion: 8` 是 architecture.md「版本与升级设计」记录的当前格式版本;这是手写
// 的 fixture 值,不是从 `.niceeval/` 读出来的(本模块从不读取 `.niceeval/`——见文件头部说明)。
// ---------------------------------------------------------------------------

const FIXTURE_SCHEMA_VERSION = 8;

function fixtureSnapshotMeta(over: Record<string, unknown>) {
  return {
    format: "niceeval.results",
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    producer: { name: "niceeval-e2e-readback-fixture", version: "0.0.0" },
    agent: "fixture-agent",
    ...over,
  };
}

function fixtureResult(over: Record<string, unknown>) {
  return { attempt: 0, durationMs: 1, assertions: [], ...over };
}

function writeJson(dir: string, filename: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), JSON.stringify(value, null, 2), "utf8");
}

interface ScopeWarningsFixture {
  /** 含 3 个 experiment 的根目录:scratch-partial(partial-coverage)、scratch-stale
   * (stale-snapshot)、scratch-broken(unreadable-snapshot,JSON 格式错误)——再加上 2 个
   * 可正常读取的 experiment,这样"单个坏快照不阻塞其余"才有东西可以验证。 */
  root: string;
  /** 另一个独立的根目录,里面只有那份格式错误的快照——对应"零可读结果"场景。 */
  onlyBrokenRoot: string;
  brokenDir: string;
}

function buildScopeWarningsFixture(scratchRoot: string): ScopeWarningsFixture {
  const root = join(scratchRoot, "scope-warnings");

  // scratch-partial:单份快照,knownEvalIds 声明了 2 个 eval,但实际只跑了 1 个
  // → partial-coverage(覆盖 1/2)。它的 startedAt 是本 fixture 根目录下最新的,这样它就不会
  // 同时又被判定为 stale-snapshot——保持这是一个干净的单一类型示例。
  const partialDir = join(root, "scratch-partial", "2026-01-10T00-00-00-000Z-bbbb");
  writeJson(partialDir, "snapshot.json", fixtureSnapshotMeta({
    experimentId: "scratch-partial",
    startedAt: "2026-01-10T00:00:00.000Z",
    completedAt: "2026-01-10T00:00:01.000Z",
    knownEvalIds: ["eval-a", "eval-ghost"],
  }));
  // 没有 `phases` 字段——同时也是本模块对"落盘无 phases 时如实显示 unavailable"的 fixture。
  writeJson(join(partialDir, "eval-a", "a0"), "result.json", fixtureResult({ id: "eval-a", verdict: "passed" }));

  // scratch-stale:单份「旧」快照,比 scratch-partial 落后 8 天 → 只触发 stale-snapshot
  // (这个 experiment 自始至终只有一份快照,所以不会有它自己的 partial-coverage)。
  const staleDir = join(root, "scratch-stale", "2026-01-02T00-00-00-000Z-cccc");
  writeJson(staleDir, "snapshot.json", fixtureSnapshotMeta({
    experimentId: "scratch-stale",
    startedAt: "2026-01-02T00:00:00.000Z",
    completedAt: "2026-01-02T00:00:01.000Z",
  }));
  writeJson(join(staleDir, "eval-c", "a0"), "result.json", fixtureResult({ id: "eval-c", verdict: "passed" }));

  // scratch-broken:snapshot.json 格式错误 → unreadable-snapshot(原因是 "malformed")。这个
  // experiment id 下没有任何可读快照——它绝不能作为一个 experiment 出现在结果里。
  const brokenDir = join(root, "scratch-broken", "2026-01-03T00-00-00-000Z-dddd");
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, "snapshot.json"), "{ this is not valid json", "utf8");
  writeJson(join(brokenDir, "eval-d", "a0"), "result.json", fixtureResult({ id: "eval-d", verdict: "passed" }));

  // 另一个独立根目录:只有那份格式错误的快照——对应"零可读结果"场景(show 非零退出,view 不启动 server)。
  const onlyBrokenRoot = join(scratchRoot, "only-broken");
  const onlyBrokenDir = join(onlyBrokenRoot, "broken-exp", "2026-01-03T00-00-00-000Z-eeee");
  mkdirSync(onlyBrokenDir, { recursive: true });
  writeFileSync(join(onlyBrokenDir, "snapshot.json"), "{ also not valid json", "utf8");
  writeJson(join(onlyBrokenDir, "eval-e", "a0"), "result.json", fixtureResult({ id: "eval-e", verdict: "passed" }));

  return { root, onlyBrokenRoot, brokenDir };
}

// ---------------------------------------------------------------------------
// 针对 CLI stdout 的小型解析辅助函数——绝不针对 `.niceeval/`。
// ---------------------------------------------------------------------------

/** `--history` 的每一行都以可排序的 "YYYY-MM-DDTHH-MM" 时间戳列开头。 */
function historyRows(output: string): { timestamp: string; locator: string }[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\s/.test(l))
    .map((l) => ({ timestamp: l.match(/^(\S+)/)![1]!, locator: l.match(/@\S+/)![0]! }));
}

function assertAscending(rows: { timestamp: string }[], context: string): void {
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1]!.timestamp <= rows[i]!.timestamp, `${context}: row ${i} (${rows[i]!.timestamp}) is out of ascending order after row ${i - 1} (${rows[i - 1]!.timestamp})`);
  }
}

/** 递归检查 `dir` 下是否存在任何名为 `name` 的文件——只用于针对 CLI 输出目录(`view --out`
 * 的导出结果),绝不用于 `.niceeval/`。 */
function containsFileNamed(dir: string, name: string): boolean {
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (containsFileNamed(full, name)) return true;
    } else if (entry.name === name) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 要点 1:选择与收窄
// ---------------------------------------------------------------------------

async function verifySelectionAndNarrowing(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // 位置参数形式的 eval id 前缀,把报告收窄到仅该 eval。
  const toolCallOnly = sh(`pnpm exec niceeval show tool-call --results ${root}`);
  assert.ok(toolCallOnly.includes("tool-call"), "show tool-call should mention the tool-call eval");
  assert.ok(!toolCallOnly.includes("deliberate"), "show tool-call narrowed the wrong way — deliberate-* leaked into a tool-call-only view");

  // 位置参数用的是原始(裸)前缀匹配,不是路径片段匹配:"deliberate" 是 "deliberate-fail" 和
  // "deliberate-error" 里的一部分单词(不涉及任何 "/"),依然能同时匹配两者——和下面 --exp 的
  // 路径片段规则形成对比,正是这个要点想说明的东西。
  const bothDeliberate = sh(`pnpm exec niceeval show deliberate --results ${root} --history`);
  assert.ok(bothDeliberate.includes("deliberate-fail"), "raw-prefix 'deliberate' should match deliberate-fail");
  assert.ok(bothDeliberate.includes("deliberate-error"), "raw-prefix 'deliberate' should match deliberate-error");
  assert.ok(!bothDeliberate.includes("tool-call"), "raw-prefix 'deliberate' should not also match tool-call/main");

  // --exp 按路径片段匹配:一个完整的片段可以匹配……
  const expExact = sh(`pnpm exec niceeval show --exp deliberate-fail --results ${root}`);
  assert.ok(expExact.includes("1 experiment"), "--exp deliberate-fail should narrow to exactly 1 experiment");
  assert.ok(!expExact.includes("tool-call"), "--exp deliberate-fail leaked tool-call/main into scope");

  // ……但不是完整片段的部分单词则不会匹配,这和上面位置参数的情况不同。
  const expPartial = shRaw(`pnpm exec niceeval show --exp deliberate --results ${root}`);
  assert.notEqual(expPartial.status, 0, "--exp deliberate (partial segment) should fail to match anything");
  assert.ok(
    expPartial.combined.includes("No experiment matched --exp deliberate"),
    `--exp deliberate should report no match (path-segment semantics differ from the positional arg's raw-prefix rule); got: ${expPartial.combined}`,
  );
  assert.ok(expPartial.combined.includes("deliberate-error") && expPartial.combined.includes("deliberate-fail") && expPartial.combined.includes("main"), "no-match message should list the candidate experiment ids");

  const expMain = sh(`pnpm exec niceeval show --exp main --results ${root}`);
  assert.ok(expMain.includes("1 experiment"), "--exp main should narrow to exactly 1 experiment");
  assert.ok(!expMain.includes("deliberate"), "--exp main leaked deliberate-* into scope");

  // --results 显式 flag(这里的值和默认值一样,但实际验证的是这个 flag 本身)。
  const explicitResults = sh(`pnpm exec niceeval show tool-call --results ${root}`);
  assert.ok(explicitResults.includes("tool-call"), "--results <root> should behave like the default root");

  // 缺少开头 "@" 的 locator 会被当作 eval id 前缀处理,匹配不到任何东西,命令会明确报告这一点
  // 并列出候选 eval id(docs/feature/reports/show.md「无匹配与不可读结果」)——而不是悄悄返回一个
  // 空结果。
  const bareBody = evidence.main.attempts[0]!.locator.slice(1); // strip leading "@"
  const noMatch = shRaw(`pnpm exec niceeval show ${bareBody} --results ${root}`);
  assert.notEqual(noMatch.status, 0, `show ${bareBody} (no @) should fail — it's not a valid eval id prefix`);
  assert.ok(noMatch.combined.includes(`No results matched: ${bareBody}`), `expected an explicit no-match message; got: ${noMatch.combined}`);
  assert.ok(noMatch.combined.includes("tool-call"), "no-match message should list tool-call as a candidate eval with results");

  // view 这一侧遵循同样的选择规则:--exp / 位置参数收窄对导出的 artifact/ 子集产生的效果,
  // 和上面 show 报告的结果一致。
  const scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-readback-view-select-"));
  try {
    const mainOut = join(scratchRoot, "main-only");
    sh(`pnpm exec niceeval view --exp main --results ${root} --out ${mainOut} --no-open`);
    assert.ok(existsSync(join(mainOut, "artifact", "main")), "view --exp main --out should export artifact/main");
    assert.ok(!existsSync(join(mainOut, "artifact", "deliberate-fail")), "view --exp main --out should NOT export artifact/deliberate-fail");
    assert.ok(!existsSync(join(mainOut, "artifact", "deliberate-error")), "view --exp main --out should NOT export artifact/deliberate-error");

    const deliberateOut = join(scratchRoot, "deliberate-only");
    sh(`pnpm exec niceeval view deliberate --results ${root} --out ${deliberateOut} --no-open`);
    assert.ok(existsSync(join(deliberateOut, "artifact", "deliberate-fail")), "view deliberate --out (raw prefix) should export artifact/deliberate-fail");
    assert.ok(existsSync(join(deliberateOut, "artifact", "deliberate-error")), "view deliberate --out (raw prefix) should export artifact/deliberate-error");
    assert.ok(!existsSync(join(deliberateOut, "artifact", "main")), "view deliberate --out should NOT export artifact/main");

    const expBad = shRaw(`pnpm exec niceeval view --exp deliberate --results ${root} --out ${join(scratchRoot, "bad")} --no-open`);
    assert.notEqual(expBad.status, 0, "view --exp deliberate (partial segment) should fail the same way show did");
    assert.ok(expBad.combined.includes("No experiment matched --exp deliberate"), "view's --exp error message should match show's");
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 要点 2:历史与多页
// ---------------------------------------------------------------------------

async function verifyHistoryAndPages(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;

  // 基线:Evidence 里唯一的真实快照有 2 个 tool-call attempt。
  const baselineHistory = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const baselineRows = historyRows(baselineHistory);
  assert.equal(baselineRows.length, evidence.main.attempts.length, "baseline --history row count should match Evidence.main.attempts");
  assertAscending(baselineRows, "baseline --history");

  // 为同一个 Experiment 制造出第二份真实快照(真实网关小额开销——专门为这项检查批准的,因为
  // Evidence 本身每个 Experiment 只会产出一份快照)。
  shExpectZero(`pnpm exec niceeval exp main --force --output ci`);

  const afterForce = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const afterForceRows = historyRows(afterForce);
  assert.equal(afterForceRows.length, baselineRows.length + 2, "a --force re-run of main should add 2 new distinct attempts to --history (runs:2)");
  assertAscending(afterForceRows, "--history after --force re-run");
  for (const original of baselineRows) {
    assert.ok(afterForceRows.some((r) => r.locator === original.locator), `--history after re-run lost the original attempt ${original.locator} — cross-snapshot merge dropped history instead of appending`);
  }

  // 一次免费的复用运行(不带 --force):eval/agent/model 都没变,指纹匹配,于是刚创建的快照里的
  // 2 个 attempt 会原封不动地被 carry forward 进第三份快照。
  const reuseOutput = shExpectZero(`pnpm exec niceeval exp main --output ci`);
  assert.ok(/reused=2/.test(reuseOutput), `expected the no-force re-run to carry forward 2 attempts (reused=2); got: ${reuseOutput}`);

  const afterReuse = sh(`pnpm exec niceeval show tool-call --results ${root} --history`);
  const afterReuseRows = historyRows(afterReuse);
  assert.equal(
    afterReuseRows.length,
    afterForceRows.length,
    `--history should DEDUP the carried-forward attempts by identity key (experimentId, evalId, attempt, startedAt) — a 3rd snapshot with the same 2 attempts carried forward must not double the row count (got ${afterReuseRows.length}, expected ${afterForceRows.length})`,
  );
  assertAscending(afterReuseRows, "--history after carry-forward reuse run");

  // --history 和 --report 互斥(两者都会接管主输出)。
  const mutex = shRaw(`pnpm exec niceeval show --history --report reports/does-not-exist.tsx --results ${root}`);
  assert.notEqual(mutex.status, 0, "--history --report should be a usage error");
  assert.ok(/mutually exclusive/i.test(mutex.combined), `expected a mutual-exclusion message; got: ${mutex.combined}`);

  // 多页:show 渲染内置的 "report" 页,并在末尾附加一份可复现的其他可导航页面
  // (attempts、traces)索引——附加的命令会把 --results 和位置参数一并带上。这里用
  // "deliberate" 前缀(匹配 2 个 eval)而不是 "tool-call"(恰好匹配 1 个 eval):收窄到单个
  // eval 会让 report 页切换成聚焦单 eval 的 drill-down 视图,那种视图根本没有页面索引——这是
  // 一种真实的、独立的展示模式,不是页面索引的 bug。
  const bareShow = sh(`pnpm exec niceeval show deliberate --results ${root}`);
  assert.ok(bareShow.includes("Other pages:"), "show should append a page index for the built-in multi-page report");
  assert.ok(bareShow.includes(`niceeval show deliberate --results ${root} --page attempts`), "page index command should reproduce positional args + --results + --page");
  assert.ok(bareShow.includes(`niceeval show deliberate --results ${root} --page traces`), "page index should list the traces page too");
  assert.ok(!/--page report\b/.test(bareShow), "the page index should not list 'report' as an OTHER page — it's the one currently rendered");

  const attemptsPage = sh(`pnpm exec niceeval show deliberate --results ${root} --page attempts`);
  assert.ok(attemptsPage.includes("Other pages:"), "--page attempts should append an index of the OTHER pages");
  assert.ok(attemptsPage.includes(`niceeval show deliberate --results ${root} --page report`), "index from the attempts page should offer report");
  assert.ok(attemptsPage.includes(`niceeval show deliberate --results ${root} --page traces`), "index from the attempts page should offer traces");
  assert.ok(!/--page attempts\b/.test(attemptsPage.split("Other pages:")[1] ?? ""), "the attempts page's own index should not re-list itself");

  const tracesPage = sh(`pnpm exec niceeval show --results ${root} --page traces`);
  assert.ok(tracesPage.includes("Other pages:"), "--page traces should append an index of the OTHER pages");
  assert.ok(tracesPage.includes("--page report"), "index from the traces page should offer report");
  assert.ok(tracesPage.includes("--page attempts"), "index from the traces page should offer attempts");

  // 未知的 page id:报用法错误并列出可用页面,不会静默回退。
  const badPage = shRaw(`pnpm exec niceeval show --results ${root} --page bogus`);
  assert.notEqual(badPage.status, 0, "--page bogus should be a usage error");
  assert.ok(
    badPage.combined.includes('page "bogus" not found') && badPage.combined.includes("report, attempts, traces"),
    `expected a "page not found" error listing the built-in page ids; got: ${badPage.combined}`,
  );
}

// ---------------------------------------------------------------------------
// 要点 3:证据切面
// ---------------------------------------------------------------------------

async function verifyEvidenceFacets(evidence: Evidence, fixture: ScopeWarningsFixture): Promise<void> {
  const root = evidence.resultsRoot;
  const passedLocator = evidence.main.attempts[0]!.locator;
  const failedLocator = evidence.deliberateFail.attempt.locator;

  // --source:在一个真实的 passed attempt 和一个真实的 failed attempt 上,都验证 eval 源码被
  // 标注上 send/assertion 标记。
  const passedSource = sh(`pnpm exec niceeval show ${passedLocator} --source --results ${root}`);
  assert.ok(passedSource.includes("evals/tool-call.eval.ts"), "--source should name the eval source file");
  assert.ok(/\S+\s*·\s*completed\s*·/.test(passedSource), `--source should annotate the t.send() line with the turn's label + status + duration; got:\n${passedSource}`);

  const failedSource = sh(`pnpm exec niceeval show ${failedLocator} --source --results ${root}`);
  assert.ok(failedSource.includes("evals/deliberate-fail.eval.ts"), "--source should name deliberate-fail's eval source file");
  assert.ok(failedSource.includes("expected 3") && failedSource.includes("received 2"), "--source should annotate the failing assertion with expected/received");

  // --execution 在真实证据上是能工作的(完整的节点覆盖已经在 verify-format.ts 的 README §4.3
  // 检查里断言过了);这里我们要断言的是"未采集 trace"时的诚实呈现——本仓库的 3 个 Experiment
  // 都没有配置 tracing/OTel,正好用来证明文档「落盘无 phases 时如实显示 unavailable,不猜」
  // 这一条,应用在 trace 子树上(下面那个没有 phases 的 fixture 检查,验证的是同一条诚实契约里
  // 「无 phases」字面意义上的那一半)。
  const execution = sh(`pnpm exec niceeval show ${passedLocator} --execution --results ${root}`);
  assert.ok(execution.includes("timing unavailable"), "--execution should say timing is unavailable when no OTel trace was collected");
  assert.ok(execution.includes("OTel trace was not collected"), "--execution's unavailable annotation should say why, not guess a value");

  // --diff 在真实证据上也能工作(进程内 aiSdkAgent 的 attempt 仍然会带上一个没有 window 的
  // diff.json——"没有改动"是一种真实的、和"diff 不可用"截然不同的结果)。
  const diff = sh(`pnpm exec niceeval show ${passedLocator} --diff --results ${root}`);
  assert.ok(diff.includes("no file changes by the agent"), `--diff should report no agent-attributed changes; got: ${diff}`);
  assert.ok(diff.includes("diff.json"), "--diff's no-changes message should still point at the full diff.json for verification");

  // --timing:有节点数上限的诊断树。在本仓库这种很小的真实 timing 树上(节点数只有几个,
  // 远低于 80 节点的预算),有限投影和完整投影必须逐字节相同——这就是 timing.md 记录的
  // "Case 1:小树" 契约,不是它的弱化替代。
  const timingSummary = sh(`pnpm exec niceeval show ${passedLocator} --timing --results ${root}`);
  const timingFull = sh(`pnpm exec niceeval show ${passedLocator} --timing=full --results ${root}`);
  assert.equal(timingSummary, timingFull, "for a small timing tree (< 80 nodes), --timing and --timing=full must render identically (timing.md Case 1)");
  assert.ok(timingSummary.includes("eval.run"), "--timing should show the eval.run phase from real runner phase data");

  // --timing 只接受 summary|full——其他任何值都是用法错误,不会静默回退。
  const badTiming = shRaw(`pnpm exec niceeval show ${passedLocator} --timing=bogus --results ${root}`);
  assert.notEqual(badTiming.status, 0, "--timing=bogus should be a usage error");
  assert.ok(badTiming.combined.includes('"summary"'), `expected --timing's usage error to name the accepted values; got: ${badTiming.combined}`);

  // 字面意义上"无 phases"的诚实呈现:一个完全没有 `phases` 字段的手写 fixture attempt,
  // 无论在 --timing 还是 --timing=full 下都必须显示 "phase timing unavailable",绝不能
  // 猜测/推导出一个总时长。
  const fixtureLocatorLine = sh(`pnpm exec niceeval show eval-a --results ${fixture.root} --history`);
  const fixtureLocator = fixtureLocatorLine.match(/@\S+/)?.[0];
  assert.ok(fixtureLocator, `could not find eval-a's locator in fixture --history output: ${fixtureLocatorLine}`);
  const noPhasesSummary = sh(`pnpm exec niceeval show ${fixtureLocator} --timing --results ${fixture.root}`);
  const noPhasesFull = sh(`pnpm exec niceeval show ${fixtureLocator} --timing=full --results ${fixture.root}`);
  assert.ok(noPhasesSummary.includes("phase timing unavailable"), `expected "phase timing unavailable" for a fixture attempt with no phases; got: ${noPhasesSummary}`);
  assert.ok(noPhasesFull.includes("phase timing unavailable"), `--timing=full should also say phase timing unavailable, not derive a fake tree; got: ${noPhasesFull}`);
}

// ---------------------------------------------------------------------------
// 要点 4:Scope 警告
// ---------------------------------------------------------------------------

async function verifyScopeWarnings(fixture: ScopeWarningsFixture): Promise<void> {
  // show:三种警告类型全部出现,并且尽管第三个 experiment 不可读,另外两个可读的 experiment
  // 依然完整渲染——"单个坏快照不阻塞其余"。
  const board = sh(`pnpm exec niceeval show --results ${fixture.root}`);
  assert.ok(board.includes("scratch-partial") && board.includes("coverage 1/2"), `expected a partial-coverage warning for scratch-partial (1/2); got:\n${board}`);
  assert.ok(board.includes("1 of 2 evals"), `partial-coverage message should state "1 of 2 evals"; got:\n${board}`);
  assert.ok(board.includes("scratch-stale") && board.includes("8 days behind"), `expected a stale-snapshot warning for scratch-stale (8 days behind); got:\n${board}`);
  assert.ok(board.includes("snapshot") && board.includes("skipped") && board.includes("malformed"), `expected an unreadable-snapshot warning mentioning the malformed skip; got:\n${board}`);
  assert.ok(board.includes(fixture.brokenDir), "unreadable-snapshot warning should name the actual skipped directory");
  // 尽管有一个 experiment 损坏,另外两个依然完整渲染(不受阻塞):
  assert.ok(board.includes("2 experiments"), `scratch-partial and scratch-stale should both still render even with scratch-broken unreadable; got:\n${board}`);
  assert.ok(board.includes("Pass rate 100%"), "the 2 readable experiments' data should compute normally, unaffected by the unreadable third");

  // view:同样的三种警告类型也会出现在静态导出结果里(和本地 server 走的是同一条站点管线——
  // README §4.2/report.md §4 已经豁免本仓库不必为每一项检查都重新起一次 server;下面第 5 点
  // 会统一验证一次 server ≡ --out 的逐字节一致性)。
  const outDir = mkdtempSync(join(tmpdir(), "niceeval-readback-warnings-out-"));
  try {
    sh(`pnpm exec niceeval view --results ${fixture.root} --out ${outDir} --no-open`);
    const indexHtml = readFileSync(join(outDir, "index.html"), "utf8");
    assert.ok(indexHtml.includes("coverage 1/2"), "view --out's index.html should carry the same partial-coverage warning as show");
    assert.ok(indexHtml.includes("8 days"), "view --out's index.html should carry the same stale-snapshot warning as show");
    assert.ok(indexHtml.includes("malformed"), "view --out's index.html should carry the same unreadable-snapshot warning as show");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // 零可读结果:show 会以明确的"无结果"消息非零退出(而不是一个空白的成功),view 则拒绝导出
  // 或提供任何服务。
  const emptyShow = shRaw(`pnpm exec niceeval show --results ${fixture.onlyBrokenRoot}`);
  assert.notEqual(emptyShow.status, 0, "show over a results root with zero readable snapshots should exit non-zero");
  assert.ok(emptyShow.combined.includes("No results found"), `expected an explicit "no results" message; got: ${emptyShow.combined}`);
  assert.ok(emptyShow.combined.includes("malformed"), "the zero-readable message should still surface why the one snapshot present was skipped");

  const emptyOutDir = join(mkdtempSync(join(tmpdir(), "niceeval-readback-empty-out-")), "site");
  const emptyOutResult = shRaw(`pnpm exec niceeval view --results ${fixture.onlyBrokenRoot} --out ${emptyOutDir} --no-open`);
  assert.notEqual(emptyOutResult.status, 0, "view --out over zero readable results should exit non-zero");
  assert.ok(!existsSync(emptyOutDir), "view --out over zero readable results must not create an empty site directory");

  const serverAttempt = await expectServerDoesNotStart(["--results", fixture.onlyBrokenRoot]);
  assert.notEqual(serverAttempt.exitCode, 0, "view over zero readable results should exit non-zero instead of starting a server");
}

// ---------------------------------------------------------------------------
// 要点 5:导出与 server
// ---------------------------------------------------------------------------

async function verifyExportAndServer(evidence: Evidence): Promise<void> {
  const root = evidence.resultsRoot;
  const mainAttemptRelDir = relative(root, evidence.main.attempts[0]!.attemptDir);
  const deliberateFailRelDir = relative(root, evidence.deliberateFail.attempt.attemptDir);

  // --- 全量根目录的本地 server:与 Evidence 已经产出的 --out 导出结果逐字节一致
  //     (view.md:"本地模式与静态导出共用同一条站点管线... 同一输入下同一路径逐字节一致")。
  //     既然这个 server 已经启动,且提供的是和 siteExportDir 相同的完整、未收窄的 scope,
  //     就顺带在它身上验证 o11y 从不被 serve、以及 sources.json 被解引用这两项检查。
  const fullServer = await startViewServer(["--results", root]);
  try {
    const indexResp = await fetch(`${fullServer.baseUrl}/`);
    assert.equal(indexResp.status, 200, "server should serve / with 200");
    const indexBody = await indexResp.text();
    const exportedIndex = readFileSync(join(evidence.siteExportDir, "index.html"), "utf8");
    assert.equal(indexBody, exportedIndex, "local server's / response must be byte-identical to the --out export's index.html for the same input");

    const attemptResp = await fetch(`${fullServer.baseUrl}/attempt/${evidence.main.attempts[0]!.locator}.html`);
    assert.equal(attemptResp.status, 200, "server should serve the attempt detail page with 200");
    const attemptBody = await attemptResp.text();
    const exportedAttempt = readFileSync(join(evidence.siteExportDir, "attempt", `${evidence.main.attempts[0]!.locator}.html`), "utf8");
    assert.equal(attemptBody, exportedAttempt, "local server's attempt page must be byte-identical to the --out export's for the same locator");

    // sources.json 在带外(server 响应)场景下是已解引用的 {path, content}[],绝不是磁盘上
    // 那种两层 {path, sha256} 引用形式(memory/attempt-locator-and-source-dedup)。
    const sourcesResp = await fetch(`${fullServer.baseUrl}/artifact/${mainAttemptRelDir}/sources.json`);
    assert.equal(sourcesResp.status, 200, "server should serve the in-scope attempt's sources.json artifact");
    const sourcesBody = (await sourcesResp.json()) as { path: string; content?: string; sha256?: string }[];
    assert.ok(sourcesBody.length > 0, "sources.json should have at least one entry");
    assert.ok(sourcesBody.every((s) => typeof s.content === "string"), "server-served sources.json entries must carry dereferenced content, not a bare sha256 reference");
    assert.ok(sourcesBody.every((s) => !("sha256" in s)), "server-served sources.json must not leak the on-disk sha256 reference field");

    // 静态导出文件里也是同样已解引用的形状。
    const exportedSourcesJson = JSON.parse(readFileSync(join(evidence.siteExportDir, "artifact", mainAttemptRelDir, "sources.json"), "utf8")) as { path: string; content?: string }[];
    assert.ok(exportedSourcesJson.every((s) => typeof s.content === "string"), "--out export's sources.json must also be dereferenced {path, content}[]");

    // o11y.json 无论是不是全量根目录都从不被 serve——这里探测的是某个真实存在 o11y.json 的
    // attempt 的真实已知路径。
    const o11yResp = await fetch(`${fullServer.baseUrl}/artifact/${mainAttemptRelDir}/o11y.json`);
    assert.equal(o11yResp.status, 404, "o11y.json must never be served by the local server, even for an in-scope attempt that has one on disk");
  } finally {
    await fullServer.stop();
  }

  // o11y.json 同样也从不被导出——遍历整棵已导出的 artifact/ 树来验证。
  assert.ok(!containsFileNamed(join(evidence.siteExportDir, "artifact"), "o11y.json"), "no o11y.json should ever appear anywhere under a --out export's artifact/ tree");

  // --- 收窄后的导出:页面 Scope 和 artifact/ 树一起收窄;scope 之外的 attempt 根本不会生成
  //     对应的 HTML 文档(和下面收窄后的 SERVER 形成对比,后者依然能解析到它——这是文档记录
  //     的两条路由之间的差异)。
  const narrowedOutDir = mkdtempSync(join(tmpdir(), "niceeval-readback-narrowed-out-"));
  try {
    sh(`pnpm exec niceeval view --exp main --results ${root} --out ${narrowedOutDir} --no-open`);
    assert.ok(existsSync(join(narrowedOutDir, "artifact", "main")), "narrowed --out should still export the in-scope experiment's artifact tree");
    assert.ok(!existsSync(join(narrowedOutDir, "artifact", "deliberate-fail")), "narrowed --out must not export the out-of-scope experiment's artifact tree");
    assert.ok(
      !existsSync(join(narrowedOutDir, "attempt", `${evidence.deliberateFail.attempt.locator}.html`)),
      "narrowed --out must not generate an HTML document for an out-of-scope attempt's locator at all",
    );
    assert.ok(
      existsSync(join(narrowedOutDir, "attempt", `${evidence.main.attempts[0]!.locator}.html`)),
      "narrowed --out should still generate the in-scope attempt's HTML document",
    );
  } finally {
    rmSync(narrowedOutDir, { recursive: true, force: true });
  }

  // --- 收窄后的本地 server:attempt-detail 这条路由无论 --exp 是什么,都会对着完整的 results
  //     根目录去解析(和 `show @<locator>` 一样是整个 result root 范围内寻址),但是原始的
  //     artifact/ 文件路由则和上面页面 Scope、--out 导出一样,遵守同样的 --exp 收窄规则——
  //     两条不同的路由,两条不同的作用域规则,都记录在 view.md 的"导出与 server"这一段里。
  const narrowedServer = await startViewServer(["--exp", "main", "--results", root]);
  try {
    const outOfScopeAttemptResp = await fetch(`${narrowedServer.baseUrl}/attempt/${evidence.deliberateFail.attempt.locator}.html`);
    assert.equal(outOfScopeAttemptResp.status, 200, "the attempt-detail route must resolve an out-of-scope locator (full-root addressing) even under --exp main");
    const outOfScopeAttemptBody = await outOfScopeAttemptResp.text();
    assert.ok(outOfScopeAttemptBody.includes("deliberate-fail"), "the resolved out-of-scope attempt page should show its real content");

    const outOfScopeArtifactResp = await fetch(`${narrowedServer.baseUrl}/artifact/${deliberateFailRelDir}/sources.json`);
    assert.equal(outOfScopeArtifactResp.status, 404, "the raw artifact/ file route MUST respect --exp narrowing, unlike the attempt-detail route above");

    const inScopeArtifactResp = await fetch(`${narrowedServer.baseUrl}/artifact/${mainAttemptRelDir}/events.json`);
    assert.equal(inScopeArtifactResp.status, 200, "the raw artifact/ file route should still serve in-scope attempts normally");
  } finally {
    await narrowedServer.stop();
  }

  // --- attempt/<locator>.html 在没有 JavaScript 的情况下也完全可读:去掉所有 <script> 标签,
  //     确认真实的 verdict/assertion 文本依然出现在剩下的标记里。
  const failedAttemptHtmlPath = join(evidence.siteExportDir, "attempt", `${evidence.deliberateFail.attempt.locator}.html`);
  const failedAttemptHtml = readFileSync(failedAttemptHtmlPath, "utf8");
  const withoutScripts = failedAttemptHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
  assert.ok(withoutScripts.includes("deliberate-fail"), "attempt HTML with all <script> tags stripped should still show the eval id");
  assert.ok(withoutScripts.includes("expected 3") && withoutScripts.includes("received 2"), "attempt HTML with all <script> tags stripped should still show the failing assertion's expected/received values");
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function verifyReadback(evidence: Evidence): Promise<void> {
  const scratchRoot = mkdtempSync(join(tmpdir(), "niceeval-readback-fixtures-"));
  try {
    const fixture = buildScopeWarningsFixture(scratchRoot);

    // 顺序很重要:verifyHistoryAndPages 是唯一会改动共享 evidence.resultsRoot 的部分
    // (它会额外发起 2 次真实的 `niceeval exp main` 调用来拿到第二份快照——具体原因见该函数
    // 自己的注释)。它必须放在最后运行,晚于 verifyExportAndServer 那个对
    // evidence.siteExportDir 的逐字节比对——那份导出结果是 produceEvidence() 一次性产出的,
    // 一旦 evidence.resultsRoot 里落地了额外的快照,它就会变得过期(和新查询出来的 server
    // 结果对不上)。其余三个部分对 evidence.resultsRoot 都是只读的(或者使用它们自己独立的
    // fixture/导出目录),所以彼此之间的先后顺序无关紧要。
    await verifySelectionAndNarrowing(evidence);
    await verifyEvidenceFacets(evidence, fixture);
    await verifyScopeWarnings(fixture);
    await verifyExportAndServer(evidence);
    await verifyHistoryAndPages(evidence);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}
