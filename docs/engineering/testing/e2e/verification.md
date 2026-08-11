# 验收脚本写法

这篇给出测试仓库 `scripts/e2e.ts` / `verify.ts` 的参考写法。
它只从 CLI 的公开使用面进入：运行 `pnpm exec niceeval ...`，断言退出码与输出（stdout、`--json` / `--junit` 文件）。

仓库自治，各仓库可以偏离这里的组织方式。
但断言面必须一致：

- 不 import niceeval 库代码；
- 不递归扫描 `.niceeval/`；
- 不依赖未公开的结果文件布局。

结果读取边界见[总则](README.md#42-results-读取边界)，CLI 读回约定见[总则](README.md#43-cli-读回)。

约定：脚本是 `.ts`、由 tsx 执行；断言用 `node:assert/strict`，不引入测试框架——验收脚本只有一条线性流程，失败即抛错、`e2e.ts` 捕获后决定退出码。
每条断言消息都要说清**哪条契约断了、下一步看哪里**。

## Adapter E2E：判分与结果消费分界

Adapter Repo 的 Eval 是唯一判分处：工具、入参、usage、session、HITL 与负断言只读取 `Turn.events`。
外层原生测试不再从 `exp --json` 的中间事件重做这些判定；它只用 Testkit 的 `ProcessReceipt.expResult()`
取得末尾原始 `ExpResultEvent`，精确比较终态计数，再读该 Adapter 独有的 execution、timing 或资源终结证据：

```ts
const result = receipt.expResult();
assert.deepEqual(
  {
    event: result.event,
    status: result.status,
    passed: result.passed,
    failed: result.failed,
    errored: result.errored,
    completion: result.completion,
  },
  {
    event: "result",
    status: "passed",
    passed: 3,
    failed: 0,
    errored: 0,
    completion: "complete",
  },
);
```

需要 locator 时可把 `receipt.ndjson<ExpEvent>()` 当作原始公开 transport receipt；不得手写 Exp 事件模型或把
`events.at(-1)` 强转成 result。Adapter 不复制 CLI owner 的默认 `show` 文本、ANSI、duration 或 JUnit 格式断言。
下文的默认 `show` 与 JUnit 示例属于各自 CLI owner；只有拥有那些输出契约的 Repo 才采用它们。

## 执行 niceeval 命令

命令以 **shell 原文**出现在脚本里——和开发者在终端里敲的一模一样，可以直接复制出去手动复现。
唯一的命令执行器只做一件事：跑命令、拿 stdout 与退出码；预期非零退出（deliberate-fail 这类）是一等场景，不是异常：

```ts
// scripts/verify.ts
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit}，预期 ${expect}。stderr 尾部：\n${res.stderr.slice(-2000)}`);
  return res.stdout;
}
```

## 用例一：跑实验，断言退出码

`--rerun all` 保证真实新跑，`--json` 保证可解码的稳定事件流，`--junit` 落 CI 出口：

```ts
const EXPECTED_EVALS = ["weather/brooklyn", "weather/hitl-reject"];

sh("pnpm exec niceeval exp weather --rerun all --json --junit junit.xml");
```

## 用例二：`show` 默认报告——应发现的 Eval 都实际运行了

少排用例不能全绿。
默认报告断言停在自有事实的子串级出现，不断言布局：

```ts
const board = sh("pnpm exec niceeval show");
for (const id of EXPECTED_EVALS) {
  assert.ok(
    board.includes(id),
    `show 默认报告缺少 ${id}——发现或选择器行为变了，先跑 pnpm exec niceeval exp weather --dry 看计划`,
  );
}
```

## 用例三：`show --history`——逐 attempt 断言 verdict，并拿到 locator

history 每行给出时间、verdict、结果摘要、耗时、成本与 locator。
它是 CLI 验收的主入口：从这里断言 verdict，也从这里提取后续证据切面命令所需的 locator。

```ts
function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(
    lines.length > 0,
    `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`,
  );
  return lines.at(-1)!;
}

for (const id of EXPECTED_EVALS) {
  const line = latestAttemptLine(id);
  assert.ok(
    line.includes("passed"),
    `${id} 最新 attempt 不是 passed：${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`,
  );
}

const locator = latestAttemptLine("weather/brooklyn").match(/@\S+/)![0];
```

## 用例四：`show --execution`——调用与入参都存在，OTel 数据可见

执行树是「适配器收到了什么」的用户可见投影：判分断言过的调用应全部以节点出现，TOOL 卡片的 `input` 块含断言过的入参值——名字和参数都要穿到展示面；OTel 期望以时间注释的展示形态核验。
（入参的判分断言在 Eval 里连名带参写：`t.calledTool("mcp__demo-tools__get_weather", { input: { city: "Brooklyn" } })`，见[适配器域](adapter/README.md)。）

```ts
const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
assert.ok(
  execution.includes("mcp__demo-tools__get_weather"),
  "执行树缺少 MCP 调用节点——调用没被归一进事件流，或 show 执行树读不回",
);
assert.ok(
  execution.includes("Brooklyn"),
  "TOOL 卡片的 input 里没有出现入参 Brooklyn——入参在归一或展示链路上被丢弃/改写",
);

// 声明 tracing 面的仓库：调用数据写进了 OTel，展示上就是节点带时间注释
assert.ok(
  !execution.includes("timing unavailable"),
  "执行树节点缺 span 时间注释——OTel 没接上或 correlation 断裂，用 show --timing 看 OTel 子树挂上没有",
);

// 未声明 tracing 面的仓库反向断言：
// assert.ok(execution.includes("timing unavailable"), "不该有 trace 的适配器出现了时间注释");
```

## 用例五：`show --timing`——OTel 写成了什么

`--execution` 回答「有没有写入」，`--timing` 回答「写成了什么」：runner 时间树下按 traceId 挂出 OTel model / tool 子树：

```ts
const timing = sh(`pnpm exec niceeval show ${locator} --timing`);
// 声明 tracing 面的仓库：OTel 子树里出现工具 span（此处以工具名为证）
assert.ok(
  timing.includes("get_weather"),
  "--timing 的 OTel 子树没有工具 span——mapper 没归一出 tool 角色，或 span 没关联到本轮",
);

// 未声明 tracing 面的仓库反向断言：--timing 只有 runner 时间树，不挂 OTel 子树
```

## 用例六：预期失败——deliberate-fail / deliberate-error（`cli`）

预期非零退出转换为仓库级验收成功；`failed` 与 `errored` 的区分从 `--junit` 出口断言——JUnit 按 verdict 折叠为 `<failure>` 与 `<error>`：

```ts
sh("pnpm exec niceeval exp deliberate-fail --rerun all --json --junit fail.xml", "nonzero");
const failXml = readFileSync("fail.xml", "utf8");
assert.ok(
  failXml.includes("<failure"),
  "deliberate-fail 的 JUnit 里没有 <failure>——断言不通过没折叠成 failed",
);
assert.ok(
  !failXml.includes("<error"),
  "deliberate-fail 混进了 <error>——failed 与 errored 的互斥判定破了",
);

sh("pnpm exec niceeval exp deliberate-error --rerun all --json --junit error.xml", "nonzero");
const errorXml = readFileSync("error.xml", "utf8");
assert.ok(
  errorXml.includes("<error"),
  "deliberate-error 的 JUnit 里没有 <error>——执行错误被误折叠成断言失败",
);
```

## 用例七：缓存三步（`cli`）

复用与新跑的区别从 `show --history` 的 attempt 行数断言——history 跨 Run 按 attempt 身份去重，复用不产生新行，`--rerun all` 产生新行：

```ts
function attemptCount(evalId: string): number {
  return sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@")).length;
}

sh("pnpm exec niceeval exp cached --rerun all --json");
const baseline = attemptCount("cached/echo");

const second = sh("pnpm exec niceeval exp cached --json"); // 不带 --rerun all：复用
assert.ok(second.includes("reused"), "第二次运行的摘要没有报告复用——缓存没生效");
assert.equal(
  attemptCount("cached/echo"),
  baseline,
  "不带 --rerun all 产生了新 attempt——缓存复用没有生效",
);

sh("pnpm exec niceeval exp cached --rerun all --json"); // 再带 --rerun all：真实新 attempt
assert.equal(attemptCount("cached/echo"), baseline + 1, "--rerun all 没有产生新 attempt——强制重跑失效");
```

## 失败分类：回归还是基础设施

`e2e.ts` 捕获 verify 抛错后按[总则的退出码契约](README.md#31-唯一命令)折叠：能确证的外部故障退 `75`，其余一律按回归退非零。
确证的依据是结构化证据——自己的 preflight / readiness 超时，或 `--json` 事件流中 `error` 事件明确指向 provider（429 / 5xx / 网络错误）：

```ts
// scripts/e2e.ts
try {
  await runVerify();
  process.exit(0);
} catch (err) {
  const ciLog = readFileSync("logs/exp-ci.log", "utf8");
  const infra =
    err instanceof InfraError || // 自己的 preflight / readiness 超时
    /"event":"error".*(429|5\d\d|ECONNREFUSED|ETIMEDOUT)/.test(ciLog); // provider 侧可确证的外部故障
  console.error(err);
  process.exit(infra ? 75 : 1);
}
```

判不准就按回归退出——宁可误报回归，不可把回归漏报成运行条件问题。
