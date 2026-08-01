# Use Case · 适配器仓库读回:停在事实级,不升级

## 场景

适配器仓库(`ai-sdk`、`claude-code`…)的 [CLI 读回](../../../engineering/testing/e2e/README.md#43-cli-读回)边界是刻意窄的:只断言自有事实的出现(调用节点、入参、tracing 期望),**不断言布局**——矩阵修复成本不随渲染格式微调放大。
这个场景演示词表分级的反面:身份级断言就是全部,结构读面在这里是过度武装。

## 现行断言

摘自 `e2e/adapter/claude-code/scripts/verify.ts` 等(各仓库同构):

```ts
const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
assert.ok(execution.includes("mcp__demo-tools__get_weather"), "执行树缺少 MCP 调用节点——…");
assert.ok(execution.includes("Brooklyn"), "TOOL 卡片的 input 里没有出现入参 Brooklyn——…");
assert.ok(!execution.includes("timing unavailable"), "执行树节点缺 span 时间注释——…");
```

这些断言**本来就是对的**——自有事实的出现,渲染怎么变都不红。
问题只有两个:locator 提取靠每仓库手搓正则,`sh()` 每仓库复制一份。

## 候选写法

```ts
adapterBehavior(mcpCallAndArgumentReachTheExecutionView, async () => {
  const locator = w.locator("weather/brooklyn");

  const { stdout } = await cli(`pnpm exec niceeval show ${locator} --execution`);
  const attempt = reportView(stdout).attempt(locator);

  expectObserved(attempt.executionNodes()).toShowRows(["shell", "get_weather"]);
  expectObserved(attempt.node("get_weather").input()).toContainValue("Brooklyn");
  expectObserved(attempt.timingGaps()).toShowExactRows([]);   // 声明 tracing 面的仓库
});
```

- 断言语义与现行完全一致:事实出现或不出现,停在身份级。
- 升格的只有基础设施:`cli()`(退出码断言与证据日志)与 locator 来自 world manifest,不再每仓库手搓正则。
- 结构导航可用但非必须;入参「出现在 TOOL 节点之内」这种结构性事实要不要锁,按各仓库评估计划自定——默认不锁,维持读回的窄边界。

这套读面**由适配器仓库自己签入**,不从 report 仓库共享。
两个仓库要观察的东西本来就不同:report 仓库需要表、图与浏览器,适配器仓库只需要 attempt 与执行节点身份。
重复的那部分(`cli()` 与 locator 读取)记为[公共包评审](../README.md#落点验收器留在所属-e2e-仓库)的证据,评审在两个自治仓库出现相同稳定需求之后进行,不提前发包。

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [用某一家的原始工具名当断言目标](../../../../memory/run-command-canonical-tool-name-portability.md) | `calledTool("command_execution")` 在 codex 上恰好绿(它的原始名就是这个字面量),复用给 claude-code 必红,而两家规范化后是同一个类目 `shell` | 写不出来:`executionNodes()` 返回的身份是规范类目,要断某家协议原生名得显式调 `node.originalName()`——「跨家断言」与「断这家协议怎么叫」成为两个词,不再靠猜字面量 |

这一条是断言词选择的教训,不是缺陷回放:新写法的价值在于把默认路径设成可移植的那一条。

## 边界

- **不引入结构读面**:读回不是渲染契约的验收面([边界声明](../../../engineering/testing/e2e/README.md#43-cli-读回)),布局断言集中在 report 仓库一处。
- 适配器仓库不在[迁移顺序](../../../design/user-readable-testing/DECISION.md#迁移顺序)的第一批:试点先在 Runner 缓存与 Report 读面各选三到五个高风险行为跑通,之后再按结论决定这里要不要跟。
- 跟迁之前,`cli()` 与身份读取同样可以在线性脚本里使用——这套词不绑定 vitest matcher。
</content>
