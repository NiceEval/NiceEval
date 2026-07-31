# 执行失败分类 —— 库用法

重试对 eval 作者与实验作者**零配置面**:没有 flag,`defineEval` / `defineExperiment` 上也没有重试参数(理由见 [README · 非目标](README.md#非目标))。
作者面的公开 API 有三个,各对应一处知识所在地:空间轴 fatal 错误类(实验/eval 作者声明自己 probe 出的死因)、`ExperimentDef.classifyFailure`(实验作者识别以第三方错误形态浮出的共享基建死因)、`Agent.classifyTurnError`(adapter 作者教回退认不出的自家协议错误)。

## eval / 实验作者:你会看到什么

不写任何声明时,自愈与止损的观察面:

- **重试中**:attempt 的 activity 行短暂显示 `turn retry 2/4 (rate_limit) — waiting 8s` 一类进度;退避中的 attempt 会让出并发槽位给别的 attempt。
- **重试成功**:结果里零痕迹——事件流、turn 数、判定与一次成功的 send 无异。
- **重试耗尽**:attempt 照常 `errored`,错误 message 带 `retries exhausted (4 attempts, rate_limit)` 一类摘要(以及耗尽的是单 send 封顶还是 attempt 总预算);没有摘要的 `errored` 说明该错误被判为不可重试、从未重试(为什么见[用例:读懂 errored](use-case/reading-errored.md))。
- **落闸**:某条失败携带 `scope: "eval"` / `"experiment"` 时,反馈流出一条 error 级 `dispatch-halted` 诊断带着失败 message(人读 `✗ experiment halted (dispatch-halted): <message>` / `✗ eval halted: <message>`,`--json` 是同一条诊断的 `warning` 事件),只在首次落闸时出现一行;同 eval / 同实验还没跑的 attempt 不再派发、计入 `unstarted`,完成状态 `incomplete`;`run.json` 里留同一个 `dispatch-halted` 诊断(形状见[止损执行体](architecture.md#止损执行体))。
- **恢复**:`errored` 与 `unstarted` 都不进指纹缓存——修好环境后重跑同一条命令,只补跑死掉与没跑的部分。

## 实验 / eval 作者:声明死因的波及范围

写 probe、fixture 校验的人最清楚失败波及多远,在抛出点直接说:

```ts
import { ExperimentFatalError } from "niceeval";

// experiments/compare/codex-nowledge.ts —— id 从路径推导,不手写
export default defineExperiment({
  sandbox: e2bSandbox({ template: CODEX_TEMPLATE }).setup(async (sandbox, ctx) => {
    // 探活实验共享的服务端隧道:失败则本实验每条 attempt 同因必死
    const probe = await sandbox.runCommand("curl", ["-sf", `${serverUrl}/health`]);
    if (probe.exitCode !== 0) {
      throw new ExperimentFatalError(
        `server probe(${serverUrl}) failed — 服务端/隧道已死,修好后更新 .env 重跑`,
        { cause: probe.stderr },
      );
    }
  }),
  setup: nowledge.setup,
});
```

fixture 级的死因用 `EvalFatalError`,只停本 eval 的剩余 attempt:

```ts
import { EvalFatalError } from "niceeval";

setup: async (_sandbox, _ctx) => {
  if (!existsSync(fixturePath)) {
    throw new EvalFatalError(`fixture ${fixturePath} 缺失,所有 Attempt 同因必死——先跑 pnpm fixtures:sync`);
  }
},
```

服务在 run **中途**死掉时,死因会以第三方错误的形态浮出(对隧道 host 的拒连、turn 层连接错误),probe 看不见它;实验分类器认得自家 host:

```ts
// experiments/compare/codex-nowledge.ts
export default defineExperiment({
  // ...
  classifyFailure({ text }) {
    // 只有实验作者知道这个 host 是全实验共享的隧道
    if (text.includes(serverHost) && /ECONNREFUSED|ENOTFOUND/.test(text)) {
      return { retryable: false, scope: "experiment", reason: "nowledge_tunnel_down" };
    }
    return undefined; // 其余交给后续链路
  },
});
```

要点:

- **message 就是修复提示**:它会走完反馈流与 `run.json` 诊断的全程,写成「现象 + 下一步」,别人(和三天后的你)照着它就能修。
- **判据是可证明性**:只有能证明「同 scope 兄弟 attempt 同因必死」才声明——共享服务、共享凭据、实验级配置属于能证明;「看起来像基建问题」不构成证明。
  拿不准就不声明,让它落成单条 attempt 的 `errored`:多烧的是钱,错杀的是整批覆盖数据,代价不对称(判据全文见 [README · 分类](README.md#分类))。
- **识别不靠类身份**:框架用结构守卫(`failureClassOf`)认这些错误,`instanceof` 在依赖树里有第二份 niceeval 时会静默失效——自己代码里如需识别也用守卫。
- **没有「可重试」错误类**:重试只发生在框架包住 `agent.send` 的那一个位置,你的 setup / test 代码不在任何重试执行体里,声明可重试无人消费([消费点的位置性](README.md#消费点是位置性的))。
  setup 里想容忍抖动,自己 try 一次即可。
- **闸落下后不可逆、不跨运行**:本次 invocation 内不再派发;下次运行从零判断,没有需要解除的状态。

## adapter 作者:`classifyTurnError`

类型形状单源在 [Architecture · 类型](architecture.md#类型)。
写分类器主要回答时间轴问题:**这个错误能否证明「这次输入未被 agent 受理」?**
能证明才返回 `{ retryable: true, reason: "..." }`——`reason` 是开放词表,用你协议里最贴切的词;拿不准返回 `undefined` 交给保守回退——不要返回 `{ retryable: false }` 把回退短路掉,它认得的通用形状(429、DNS 失败、拒连)你不必重复。
实验分类器排在你之前(决议序见 [Architecture · 分类链](architecture.md#分类链)),实验作者认领的失败问不到你,不冲突。

```ts
import { defineSandboxAgent, turnErrorText } from "niceeval/adapter";
import type { TurnFailure, FailureClass } from "niceeval/adapter";

export function acmeAgent() {
  return defineSandboxAgent({
    name: "acme",
    // ... setup / send ...
    classifyTurnError(failure: TurnFailure): FailureClass | undefined {
      // acme CLI 把服务端入场拒绝写成固定短语;该短语只在首个模型请求被受理前出现
      if (failure.type === "turn-failed" && turnErrorText(failure.turn)?.includes("ACME_QUEUE_FULL")) {
        return { retryable: true, reason: "acme_queue_full" };
      }
      return undefined; // 其余交给保守回退
    },
  });
}
```

要点:

- **`undefined` 是常态返回值**,只在协议知识能给出更准答案时给结果;分类器要快、纯、不抛错——抛错按 `undefined` 回落处理并被吞掉,等于白写一路。
- **不在 `send` 里自己整段重发**:断连重连这类内层自愈是被测 CLI 的原生能力(codex 会,bub 不会),adapter 不代偿;`send` 浮出的失败就是 agent 侧的最终结果,框架层的重发归重试执行体(分层见 [README · 自愈阶梯与止损阶梯](README.md#自愈阶梯与止损阶梯))。
- **空间轴从严**:adapter 也可以给 `scope`,但只限协议层能证明死因为实验共享的场景(凭据失效、账号封禁这类「后续每次调用必死」的明确回执);误扩 scope 停掉的是用户的整批实验,判据比时间轴更重。
  协议回执说不清波及范围时,只给时间轴。
- **只声明决策与词,不碰策略**:重试几次、退避多久、闸怎么落都归执行体,对所有 agent 一致;`reason` 只出现在 activity 行与文案里(上例批跑时会看到 `turn retry 2/4 (acme_queue_full)`),不进任何分支;失败 Turn 里已有 agent 产出事件时,[受理证据门](architecture.md#分类链)会否决你的可重试判断。
- **歧义文案默认不归可重试**:流中断、响应中途重置这类错误,只有当你能证明该文案在自家协议里**只在受理前出现**(如上例的固定入场拒绝短语)才归可重试;「看起来像基建抖动」不构成证明,判据全文见 [README · 分类](README.md#分类)。

内置 adapter 与自定义 adapter(`defineAgent` / `defineSandboxAgent`)同一挂载面,没有第二条注册通道。

## 相关阅读

- [README](README.md) —— 两轴判据、声明通道、止损语义与非目标。
- [Architecture](architecture.md) —— 类型形状、分类链、重试执行体、止损执行体。
- [用例](use-case/README.md) —— 全流程叙事。
- [Adapter · 编写 Adapter](../adapters/library/writing-an-adapter.md) —— send 的组织方式,分类器读的错误从哪来。
