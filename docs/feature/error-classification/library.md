# 执行错误类型 —— 库用法

这个功能对 eval 作者与实验作者**零配置面**:没有 flag,`defineEval` / `defineExperiment` 上也没有字段(理由见 [README · 非目标](README.md#非目标))。唯一的公开 API 面向 adapter 作者:`Agent.classifyTurnError`,教兜底分类器认不出的自家错误形状。

## eval / 实验作者:你会看到什么

不需要写任何代码,自愈行为的观察面只有三处:

- **重试中**:attempt 的 activity 行短暂显示 `turn retry 2/4 (rate_limit) — waiting 8s` 一类进度;退避中的 attempt 会让出并发槽位给别的 attempt。
- **重试成功**:结果里零痕迹——事件流、turn 数、判定与一次成功的 send 无异。
- **重试耗尽**:attempt 照常 `errored`,错误 message 带 `retries exhausted (4 attempts, rate_limit)` 一类摘要,告诉你框架已经试过(以及耗尽的是单 send 封顶还是 attempt 总预算);没有摘要的 `errored` 说明该错误被判为不可重试、从未重试(为什么见[用例:流中断不重试](use-case/stream-drop-no-retry.md))。`errored` 不进指纹缓存,重跑同一条命令只补跑失败的 attempt。

## adapter 作者:`classifyTurnError`

类型形状单源在 [Architecture · 类型](architecture.md#类型)。写分类器只回答一个问题:**这个错误能否证明「这次输入未被 agent 受理」?** 能证明才返回 `{ retryable: true, reason: "..." }`——`reason` 是开放词表,用你协议里最贴切的词,不必塞进内建的 `rate_limit` / `network`;拿不准返回 `undefined` 交给保守兜底——不要返回 `{ retryable: false }` 把兜底也短路掉,兜底认得的通用形状(429、DNS 失败、拒连)你不必重复。

```ts
import { defineSandboxAgent, turnErrorText } from "niceeval/adapter";
import type { TurnFailure, TurnErrorClass } from "niceeval/adapter";

export function acmeAgent() {
  return defineSandboxAgent({
    name: "acme",
    // ... setup / send ...
    classifyTurnError(failure: TurnFailure): TurnErrorClass | undefined {
      // acme CLI 把服务端入场拒绝写成固定短语;该短语只在首个模型请求被受理前出现
      if (failure.type === "turn-failed" && turnErrorText(failure.turn)?.includes("ACME_QUEUE_FULL")) {
        return { retryable: true, reason: "acme_queue_full" };
      }
      return undefined; // 其余交给保守兜底
    },
  });
}
```

要点:

- **`undefined` 是常态返回值**,只在协议知识能给出比兜底更准的答案时给结果;分类器要快、纯、不抛错——抛错按不可重试处理并被吞掉,等于白写一路。
- **不在 `send` 里自己整段重发**:断连重连这类内层自愈是被测 CLI 的原生能力(codex 会,bub 不会),adapter 不代偿;`send` 浮出的失败就是 agent 侧的最终结果,框架层的重发归重试执行体(分层见 [README · 自愈阶梯](README.md#在自愈阶梯里的位置))。
- **只声明决策与词,不碰策略**:重试几次、退避多久、要不要真的重试都归执行体,对所有 agent 一致;`reason` 只出现在 activity 行与耗尽摘要里(上例批跑时会看到 `turn retry 2/4 (acme_queue_full)`),不进任何分支;失败 Turn 里已有 agent 产出事件时,[受理证据门](architecture.md#分类链)会否决你的可重试判断。
- **歧义文案默认不归可重试**:流中断、响应中途重置这类错误,只有当你能证明该文案在自家协议里**只在受理前出现**(如上例的固定入场拒绝短语)才归可重试;「看起来像基建抖动」不构成证明,判据全文见 [README · 分类](README.md#分类)。

内置 adapter 与自定义 adapter(`defineAgent` / `defineSandboxAgent`)同一挂载面,没有第二条注册通道。

## 相关阅读

- [README](README.md) —— 三分类判据与非目标。
- [Architecture](architecture.md) —— `TurnFailure` / `TurnErrorClassifier` 形状、分类链、重试执行体。
- [用例](use-case/README.md) —— 三个全流程叙事。
- [Adapter · 编写 Adapter](../adapters/library/writing-an-adapter.md) —— send 的组织方式,分类器读的错误从哪来。
