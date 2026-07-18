# 验收脚本写法

这篇给出测试仓库 `scripts/e2e.ts` / `verify.ts` 的参考写法：怎么执行 `niceeval` 命令、怎么断言返回的就是需要的。仓库自治——各仓库可以偏离这里的组织方式，但断言面必须一致：进程退出码、CLI 展示输出、`--json` / `--junit` 出口、`openResults()`，不递归扫 `.niceeval/`（见[总则 · Results 读取边界](README.md#42-results-读取边界)与 [CLI 读回](README.md#43-cli-读回)）。

约定：脚本是 `.ts`、由 tsx 执行；断言用 `node:assert/strict`，不引入测试框架——验收脚本只有一条线性流程，失败即抛错、`e2e.ts` 捕获后决定退出码。每条断言消息都要说清**哪条契约断了、下一步看哪里**。

## 执行 niceeval 命令

所有命令经一个 helper 起子进程，捕获 stdout / stderr / 退出码；预期非零退出是一等场景，不是异常：

```ts
// scripts/verify.ts
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

type RunResult = { stdout: string; stderr: string; exit: number };

function niceeval(args: string[], expect: number | "nonzero" = 0): RunResult {
  const res = spawnSync("pnpm", ["exec", "niceeval", ...args], { encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(
    ok,
    `niceeval ${args.join(" ")} 退出 ${exit}，预期 ${expect}。stderr 尾部：\n${res.stderr.slice(-2000)}`,
  );
  return { stdout: res.stdout, stderr: res.stderr, exit };
}
```

## 用例一：跑实验，断言 Eval 集合与 verdict

`--force` 保证真实新跑，`--output ci` 保证只追加的稳定日志，`--junit` 落 CI 出口：

```ts
import { openResults } from "niceeval/results";

const EXPECTED_EVALS = ["weather/brooklyn", "weather/hitl-reject"];

niceeval(["exp", "weather", "--force", "--output", "ci", "--junit", "junit.xml"]);

const results = await openResults(".niceeval");
const exp = results.experiments.find((e) => e.id === "weather/base");
assert.ok(exp, "实验 weather/base 没有产生任何快照——检查 experiments/ 发现与命名");

const snap = exp.latest;
assert.ok(snap.completedAt, "最新快照未收尾——运行中断，看 ci 日志的最后一个 phase");

// 应发现的 Eval 都实际运行了：少排用例不能全绿
assert.deepEqual(
  snap.evals.map((e) => e.id).sort(),
  EXPECTED_EVALS,
  "实际运行的 Eval 集合与预期不符——发现或选择器行为变了",
);
for (const a of snap.attempts) {
  assert.equal(a.result.verdict, "passed", `${a.evalId} verdict=${a.result.verdict}，用 niceeval show 看主失败断言`);
}
```

## 用例二：CLI 读回——`show` 榜单

同一份新结果直接读回。断言停在自有事实的子串级出现，不断言布局：

```ts
const show = niceeval(["show"]);
for (const id of EXPECTED_EVALS) {
  assert.ok(show.stdout.includes(id), `show 榜单缺少 ${id}——落盘在但读面选不中，怀疑 Scope 选择`);
}
```

## 用例三：CLI 读回——`show --execution` 执行树

执行树是「适配器收到了什么」的用户可见投影：判分断言过的调用应全部以节点出现，OTel 期望也在这里以展示形式核验。locator 从读取面的 `attempt.ref` 拼出——它与 CLI / view 深链是同一身份契约：

```ts
const attempt = snap.evals.find((e) => e.id === "weather/brooklyn")!.attempts[0];
const locator = `@${attempt.ref.snapshot}/${attempt.ref.attempt}`;

const exec = niceeval(["show", locator, "--execution"]);
assert.ok(
  exec.stdout.includes("mcp__demo-tools__get_weather"),
  "执行树缺少 MCP 调用节点——调用没被归一进事件流，或 show 执行树读不回",
);

// 声明 tracing 面的仓库：调用记录到了 OTel，展示上就是节点带时间注释
assert.ok(
  !exec.stdout.includes("timing unavailable"),
  "执行树节点缺 span 时间注释——OTel 没接上或 span 关联失败，用用例四抽查 trace",
);

// 未声明 tracing 面的仓库反向断言：
// assert.ok(exec.stdout.includes("timing unavailable"), "不该有 trace 的适配器出现了时间注释");
```

## 用例四：`openResults()` 兜底——展示读不出的机制事实

trace 的有无、span 与事件的显式 correlation 走结构化读取：

```ts
// 声明 tracing 面的仓库
const trace = await attempt.trace();
assert.ok(trace && trace.length > 0, "attempt 没有落 trace——OTLP 接收或导出配置断了");
const events = await attempt.events();
const callIds = new Set(
  events!.filter((e) => e.type === "action.called").map((e) => e.callId),
);
assert.ok(
  trace.some((s) => callIds.has(s.attributes?.["gen_ai.tool.call.id"] as string)),
  "没有任何 span 经 gen_ai.tool.call.id 关联到工具事件——mapper 没归一到 GenAI 语义约定",
);

// 未声明 tracing 面的仓库
// assert.equal(await attempt.trace(), null, "不该产生 trace 的适配器产生了 trace");
```

## 用例五：预期失败——deliberate-fail / deliberate-error（`cli-contract`）

预期非零退出转换为仓库级验收成功；`failed` 与 `errored` 必须判然有别：

```ts
niceeval(["exp", "deliberate-fail", "--force", "--output", "ci"], "nonzero");
niceeval(["exp", "deliberate-error", "--force", "--output", "ci"], "nonzero");

const after = await openResults(".niceeval");
const failSnap = after.experiments.find((e) => e.id === "deliberate-fail")!.latest;
assert.ok(failSnap.attempts.every((a) => a.result.verdict === "failed"), "deliberate-fail 应折叠为 failed");
const errSnap = after.experiments.find((e) => e.id === "deliberate-error")!.latest;
assert.ok(errSnap.attempts.every((a) => a.result.verdict === "errored"), "deliberate-error 应折叠为 errored，不能混进 failed");
```

## 用例六：缓存三步（`cli-contract`）

```ts
niceeval(["exp", "cached", "--force", "--output", "ci"]);
const base = await openResults(".niceeval");
const baseline = base.experiments.find((e) => e.id === "cached")!.snapshots.length;

niceeval(["exp", "cached", "--output", "ci"]);          // 不带 --force：复用
const reused = await openResults(".niceeval");
assert.equal(
  reused.experiments.find((e) => e.id === "cached")!.snapshots.length,
  baseline,
  "不带 --force 产生了新快照——缓存复用没有生效",
);

niceeval(["exp", "cached", "--force", "--output", "ci"]); // 再带 --force：真实新 attempt
const forced = await openResults(".niceeval");
assert.equal(
  forced.experiments.find((e) => e.id === "cached")!.snapshots.length,
  baseline + 1,
  "--force 没有产生新快照——强制重跑失效",
);
```

## 失败分类：回归还是基础设施

`e2e.ts` 捕获 verify 抛错后按[总则的退出码契约](README.md#31-唯一命令)折叠：能确证的外部故障退 `75`，其余一律按回归退非零。确证的依据是结构化证据，不是猜：

```ts
// scripts/e2e.ts
try {
  await runVerify();
  process.exit(0);
} catch (err) {
  const infra =
    err instanceof InfraError ||                         // 自己的 preflight / readiness 超时
    attemptsErroredByProvider(await openResults(".niceeval")); // attempt error 明确指向 429/5xx/网络
  console.error(err);
  process.exit(infra ? 75 : 1);
}
```

判不准就按回归退出——宁可误报回归，不可把回归漏报成环境问题。
