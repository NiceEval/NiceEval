# Eval —— 编写 eval

写一个 eval 应该像写一个测试:一个文件、一个 `test(t)` 函数,断言写在你观察结果的地方。

## `defineEval` 的形状

```typescript
import { defineEval } from "niceeval";

export default defineEval({
  description?: string;            // 人读的描述,出现在报告里
  tags?: string[];                 // 供 --tag 过滤
  judge?: JudgeConfig;             // 覆盖默认裁判模型
  reporters?: Reporter[];          // 这个 eval 专用的报告器
  timeoutMs?: number;              // 覆盖默认超时
  metadata?: Record<string, unknown>;
  async setup(sandbox, ctx) { /* 这条 eval 的沙箱预置;ctx 可报告 progress/diagnostic */ },
  async test(t) { /* 交互 + 断言 */ },
});
```

`setup` 是**这条 eval 的任务层预置**:拿到的是完整 `Sandbox`(不是 `test` 里那个受限的 `t.sandbox` 视图),在上传 workspace、打 git 基线之后、agent 接入之前跑,用来准备这次任务的素材(例如 `npm install` 起始项目的依赖)。第二个参数是绑定到 `eval.setup` 的窄上下文,可用 `ctx.progress(...)` 报告短期 activity、用 `ctx.diagnostic(...)` 报告永久 warning/error。可以返回一个 cleanup 函数,由运行器在 attempt 收尾时调用。它与另外两层 setup 分工不同:环境层的 `sandbox.setup`(不知道跑哪个 eval)、协议层的 `agent.setup`(装 CLI、写鉴权),见 [Sandbox](../sandbox/README.md)。

**禁止**提供 `id` / `name` —— 它们从文件路径推导:`evals/weather/brooklyn.eval.ts` → id `weather/brooklyn`。改名即改 id,不会腐烂。

单轮、多轮、数据集扇出、沙箱型的完整写法见 [Library](library.md);API 取舍背后的设计依据见 [Architecture](architecture.md)。评分手段(judge、匹配器、gate/soft)单独成篇,见 [Scoring](../scoring/README.md)。

## 相关阅读

- [Library](library.md) —— 单轮、多轮、HITL、数据集扇出、沙箱型的完整写法与命名约定。
- [Eval Context](library/context.md) —— `t`、`session`、`turn` 怎样驱动会话和读取结果。
- [Architecture](architecture.md) —— 为什么作用域断言按接收者(`t` / `session` / `turn`)分层,对齐 eve 的设计依据。
- [Scoring](../scoring/README.md) —— 值断言、作用域断言、judge、严重度与判定规则。
- [Agents 与 Adapters](../adapters/README.md) —— agent 三类 transport 与 agent 适配。
- [Experiments](../experiments/README.md) —— eval 由谁跑、跑几次、对着哪个 agent。
