# Use Case · 适配器仓库读回:点查询,不升级

## 场景

适配器仓库(`ai-sdk`、`claude-code`…)的 [CLI 读回](../../../engineering/testing/e2e/README.md#43-cli-读回)边界是刻意窄的:只断言自有事实的出现(调用节点、入参、tracing 期望),**不断言布局**——矩阵修复成本不随渲染格式微调放大。这个场景演示的是词表分级的反面:第三层点查询就是全部,语义树快照在这里是过度武装。

## 现行断言

摘自 `e2e/adapter/claude-code/scripts/verify.ts` 等(各仓库同构):

```ts
const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
assert.ok(execution.includes("mcp__demo-tools__get_weather"), "执行树缺少 MCP 调用节点——…");
assert.ok(execution.includes("Brooklyn"), "TOOL 卡片的 input 里没有出现入参 Brooklyn——…");
assert.ok(!execution.includes("timing unavailable"), "执行树节点缺 span 时间注释——…");
```

这些断言**本来就是对的**——自有事实的子串级出现,渲染怎么变都不红。问题只有两个:locator 提取靠每仓库手搓正则,`sh()` 每仓库复制一份。

## 候选写法

```ts
test("MCP 调用与入参穿透到执行树展示面", async () => {
  const locator = term((await cli(`pnpm exec niceeval show weather/brooklyn --history`)).stdout)
    .historyRows().at(-1)!.locator;

  const { stdout } = await cli(`pnpm exec niceeval show ${locator} --execution`);
  const t = term(stdout);

  t.line(/mcp__demo-tools__get_weather/);        // 找不到即抛错,错误信息附最近似候选行
  t.line(/Brooklyn/);
  expect(t.has(/timing unavailable/)).toBe(false); // 声明 tracing 面的仓库;未声明的反向断言 toBe(true)
});
```

- 断言语义与现行完全一致:事实出现 / 不出现,停在子串级。
- 升格的只有基础设施:`cli()`(退出码断言 + 证据日志)与 `historyRows()`(locator 提取)来自库,不再每仓库复制。
- 结构导航(`t.tree().find(...)`)可用但非必须;入参「出现在 TOOL 节点之内」这种结构性事实要不要锁,按各仓库评估计划自定——默认不锁,维持读回的窄边界。

## 边界

- **不引入语义树快照**:读回不是渲染契约的验收面([边界声明](../../../engineering/testing/e2e/README.md#43-cli-读回)),布局断言集中在 report 仓库一处。
- 适配器仓库是否随 report 一起迁 vitest 是[待裁决分歧 1](../README.md#待裁决分歧);不迁时点查询与 `cli()` 同样可在线性脚本里使用——库不绑定 vitest matcher 才可用。
