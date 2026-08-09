# Assertion 作者面 —— Architecture

本页定义结构化 command、工具输入与 Sandbox diff 怎样进入 Assertion。
公开调用见 [Library](library.md)，inline 关系见 [Rule](matching.md)。

## 分层

```text
Adapter native protocol
  │ 显式、版本化映射
  ▼
Original command + standard logical normalizer
  │ durable Observation + evidenceCoverage
  ▼
Scoped assertion / Sandbox diff collector
  │ 领域规则三态求值
  ▼
AssertionResult + evidence
```

Adapter 负责解释原生协议。
core 不按工具名、JSON key 或显示文本猜 command；Assertion evaluator 也不读取 Adapter 私有 transcript。

## Command projection

每笔 tool `operation.started` 都携带穷尽的 command classification：

```ts
type CommandProjection =
  | { readonly kind: "not-command" }
  | {
      readonly kind: "command";
      readonly original:
        | {
            readonly state: "available";
            readonly executable: string;
            readonly args: readonly string[];
          }
        | {
            readonly state: "opaque";
            readonly reason:
              | "redacted"
              | "truncated"
              | "compound-shell"
              | "dynamic-shell"
              | "unsupported-protocol";
          };
      readonly logical:
        | {
            readonly state: "available";
            readonly executable: string;
            readonly args: readonly string[];
            readonly normalizer: "logical-command/v1";
            readonly normalization: "identity" | "pnpm-exec" | "npx";
          }
        | {
            readonly state: "opaque";
            readonly normalizer: "logical-command/v1";
            readonly reason: "original-opaque";
            readonly originalReason:
              | "redacted"
              | "truncated"
              | "compound-shell"
              | "dynamic-shell"
              | "unsupported-protocol";
          }
        | {
            readonly state: "opaque";
            readonly normalizer: "logical-command/v1";
            readonly reason:
              | "unsupported-wrapper-form"
              | "ambiguous-wrapper-target"
              | "multiple-executions";
          };
    };
```

Adapter 只有在原生协议直接提供 argv，或能按该协议明确声明的 grammar 无歧义取得单一 invocation 时，才能把 original 标为 available。
复合 shell、动态展开、管道或无法确认 quoting 的 source 在 Adapter 边界直接成为 original opaque，不能靠空格 split 伪造 argv，也不交给 normalizer 再猜。

Observation Protocol 的唯一 `logical-command/v1` normalizer 只消费 available original tokens。
它保留 direct command，并把 exact `pnpm exec <target> ...`、`pnpm --silent exec <target> ...` 与无 runner-option 的 exact `npx <target> ...` 投影成 target 的 logical executable / args。
`--silent` 属于 original runner args，不进入 logical args；child 边界后的未知 flag 则原样保留。

该 normalizer 不做 basename、PATH resolution 或开放式 wrapper 猜测。
未知 pnpm runner flag、递归执行、歧义 target 与不支持的 npx form 保留 available original、logical opaque；`npm exec`、yarn、bun、dlx、corepack 与绝对路径 runner 按 identity 处理。

logical command 表示用户请求的逻辑 CLI，不证明 package provenance、版本或物理 binary identity。
因此 direct `niceeval`、`pnpm exec niceeval`、`pnpm --silent exec niceeval` 与 `npx niceeval` 都能满足同一个 `executable: "niceeval"`。
诊断只能说“匹配逻辑命令”，不能说定位或执行了某个特定 binary。

## Logical tool occurrence

```ts
interface LogicalToolOccurrence {
  readonly id: string;
  readonly session: string;
  readonly turn: string;
  readonly name: {
    readonly original: string;
    readonly canonical?: string;
  };
  readonly input: JsonValue;
  readonly command: CommandProjection;
  readonly start: EventPosition;
  readonly finish?: EventPosition;
  readonly status: "pending" | "completed" | "failed" | "rejected";
}
```

command 是同一笔 tool occurrence 的标准投影，不拥有第二个 identity。
`ToolMatch.command`、input、output 与 status 都在这组 occurrence 上运行。

orphan finish 没有可信 start、input 或 command classification。
它只能进入协议诊断，不能满足 `ToolMatch.command`。

## Actions coverage

Adapter 只有同时满足以下条件，才能声明 `actions: complete`：

1. 原生协议中的全部 action occurrences 都进入标准事件流；
2. 每笔 tool occurrence 都有 command / not-command classification；
3. 原生协议明确提供的 input 全部保留；
4. 没有无法识别的 action kind、丢失的 start 或未交代的截断。

logical invocation opaque 不必自动降低整个 actions channel。
它表示 occurrence 集合已知，但依赖 invocation 的 selector 仍可能 unavailable。

Adapter 无法判断 command / not-command 时必须降低 actions coverage。
它不能因为工具名是 `shell`，或 input 含 `command`、`cmd`、`program`、`args` 而宣称 complete。

## ToolMatch command 真值

一笔 occurrence 的 command 字段只读取 logical，有三种结果：

| Evidence | Result |
|---|---|
| logical available，executable、prefix 与 excludes 全满足 | definite match |
| logical available，任一条件不满足 | definite mismatch |
| logical opaque | indeterminate |
| not-command | definite mismatch |

ToolMatch 的 name、input、output、status 与 command 使用三值 AND。
任一字段 definite mismatch 就使整笔 occurrence definite mismatch；全部字段 definite match 才是 definite match；其余才是 indeterminate。
因此与其它字段已经矛盾的 opaque command 不会污染候选集合，false 压过 unknown。

`calledTool()` 找到一笔 completed definite ToolMatch 就可 passed。
没有 definite match，且 actions complete、没有 compatible indeterminate candidate 时 failed；其余是 unavailable。

负存在性与 count 复用同一 occurrence 真值：

- `notCalledTool()` 发现 definite match 立即 failed；compatible indeterminate candidate 或 partial actions 使结果 unavailable；只有 complete 且没有 possible match 才 passed；
- exact count 的 definite matches 已超过 expected 时立即 failed；只有 actions complete、没有 indeterminate candidate 且 definite count 等于 expected 才 passed；
- definite count 尚未超额，但 partial / indeterminate 仍可能改变 exact count 时 unavailable；
- count predicate 只在 complete、无 indeterminate、count 唯一确定时调用；任意不确定区间不猜 predicate 的单调性，返回 unavailable。

## `toolOrder()` 顺序

`toolOrder()` 按 request position 对 logical tool occurrences 做子序列匹配。
每个 selector 由 `name` 和去掉 count 的同一份 `ToolMatch` 组成。
既有 string selector 在登记边界等价为只含 `{ name }` 的 selector，不建立第二套匹配语义。

算法对同一组 occurrence 计算两条子序列关系：definite path 只接受 definite match；possible path 接受 definite match 或 indeterminate candidate。
两者都按单调 cursor 消费不同 actual index，不相关工具可以穿插；一笔 occurrence 不能占两个 selector，`multiple-executions` 也不会被拆成多笔。

- 存在 definite path 时 passed，即使 actions partial；
- 没有 definite path，但存在 possible path 时 unavailable；
- observed occurrences 没有 possible path、但 actions partial 时 unavailable；
- 只有 actions complete 且没有 possible path 时 failed。

例如 `[A? opaque, B definite]` 对 `[A, B]` 是 unavailable；`[B definite, A definite]` 在 complete channel 上 failed；唯一一笔同时可能匹配 A / B 的 occurrence 不能复用，因此在 complete channel 上 failed。

selector 的 `status: "completed"` 只证明该 occurrence 最终 completed。
它不证明前一项 finish 早于后一项 start，也不建立工具输出被下一步消费的因果关系。

`toolOrder()` 不证明动态 locator 被后续命令复用、show 输出影响了后续动作，或最终 reply 基于这些证据。
它不增加 message selector，也不冒充因果检查。

## Command 诊断与脱敏

AssertionResult 不把 argv 重新拼成仿真 shell text。
passed、failed 与 unavailable 都用有界 token 数组展示 `original.argv`、`logical.argv`、normalizer 与 normalization / opaque reason。
logical match 的文案固定说明它是逻辑命令请求，不是物理 binary provenance。

original 与 logical preview 复用 Observation Record 已执行的 secret redaction、truncation 与预算结果。
Assertion evaluator 不复制未脱敏 argv，也不从 tool input 重建一份旁路 evidence。
`toolOrder()` unavailable 必须指出第一个无法确定的 selector index、normalizer 和 opaque reason，不能误报成“未调用 niceeval”。

## 工具输入负断言

`toolInputsExclude()` 只检查标准 tool occurrence 的 input string leaves。
它不检查 stdout、assistant reply、子进程变量集合、文件描述符或 OS syscall。

walker 只访问 plain JSON value：

- object 按 own enumerable string keys 遍历 value，不检查 key；
- array 按 index 遍历；
- 不调用 getter、`toJSON` 或 `String()`；
- number、boolean 与 null 不进入路径匹配。

| Evidence | Result |
|---|---|
| 任一 string leaf definite path match | failed |
| actions complete、所选 inputs 全部可遍历、没有 match | passed |
| actions 不完整，且没有已知 match | unavailable |
| input 有可能隐藏 string 的 opaque subtree，且没有已知 match | unavailable |

报告必须把这项结果写成“observed tool inputs 没有引用目标路径”。
它不能写成“Agent 没有读取文件”。

## Sandbox diff collector

`t.sandbox` 消费 Runner 已有的 agent 归因 diff。
fixture、Eval 自己的验证命令与 Agent 完成后的材料写入不进入该 diff。

`changedPaths()`、`noChanges()`、`fileChanged()` 与 `fileDeleted()` 共用一份 collector。
path set 是 `diff.files` 的 normalized keys；净改回原样仍保留在集合，因为范围纪律关心 Agent 是否触及。

exact set 的三值规则是：

- 已观察到 expected 外的确定 path，立即 failed；
- collector complete 时，集合相等 passed，不等 failed；
- collector partial 且尚无矛盾时 unavailable。

`noChanges()` 固定 expected 为空集。
它不是另一套“diff 文本为空”检查。

### 同一条 change 的前后文本

带 `FileChangeOptions` 的 `fileChanged()` 在 agent diff 的 send 区间中寻找一条同时满足 path、kind 与内容条件的 entry。
两个内容条件不能分别由不同 send 区间满足。

available UTF-8 内容按 literal substring 检查。
binary、oversized 或 provider 不支持内容证据时是 unavailable；确定缺少 before / after 或文本不命中时 failed。

该断言只证明 before / after 各含一段文本。
它不证明只修改了一个 token，也不把内容重新读取为最终文件后再冒充 change evidence。

## 延迟 Sandbox file

`t.sandbox.file(path)` 创建惰性 source，不立即 I/O。
`t.check()` finalize 或 awaited control boundary 到达时，file source reader 执行一次 read 与 strict UTF-8 decode。

missing 与 invalid UTF-8 是 candidate failed。
permission、transport、timeout 与 terminated 表示拿不到 candidate，因此 unavailable；provider 返回非法 envelope 才是 defect。

本 Roadmap 不提供延迟 JSON source。
JSON syntax failure 的分类问题因此不会进入 Assertion API；应用自己取得的任意值继续使用现有 value assertion。

## 公开诊断边界

Harness 仍需要关联 `niceeval show` 的 command、stdout、动态 locator、后续 source/execution 调用与最终建议，但本 Roadmap 不把这些关系编码成新的确定性断言。
CLI 无法呈现这些事实时，应暴露 NiceEval 呈现缺口；Eval 不能绕过 CLI 读取 `.niceeval` 私有文件，也不能要求 Agent 生成一份专供 Assertion 的 JSON。

## Error classification

以下情况在登记边界同步报告 author error：

- 空 executable、空 command token、重复 excludes；
- 空 path exclusion、重复 expected changed path；
- inline rule 同时出现互斥关系或空 contains；
- `toolOrder()` 少于两项；
- `.points(0)` 或非有限 points。

以下情况是 failed：

- available evidence 与 rule 不匹配；
- Sandbox file missing 或 invalid UTF-8；
- complete path set 不相等。

以下情况是 unavailable：

- required coverage 不足且事实仍可能成立；
- logical command opaque；
- Sandbox permission、transport、timeout 或 terminated；
- diff 内容是 binary 或 oversized，但 Assertion 需要内容。

只有框架、Adapter、provider 或 evaluator 违反自身协议时，Attempt 才 errored。

## 防止 API 膨胀

普通 API 不共享万能 `Rule` 联合，也不提供 `allOf`、`oneOf`、`not` 或 arbitrary predicate。
一个新方法必须满足四个条件：有标准 observation owner、至少两个真实下游、可定义 coverage、无法由现有领域方法清楚表达。

这次只扩展既有 `ToolMatch`、让 `toolOrder()` 接受同源 `ToolSelector`，并补齐既有 `t.sandbox`。
Harness 的输出格式、case 名和评分 rubric 留在用例，不能反向进入 core API。
