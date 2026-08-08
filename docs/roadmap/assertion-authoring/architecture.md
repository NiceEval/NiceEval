# Assertion 作者面 —— Architecture

本页定义结构化 command、工具输入与 Sandbox diff 怎样进入 Assertion。
公开调用见 [Library](library.md)，inline 关系见 [Rule](matching.md)。

## 分层

```text
Adapter native protocol
  │ 显式、版本化映射
  ▼
Standard Observation + evidenceCoverage
  │ core 合成 logical occurrence
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
      readonly invocation:
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
              | "unsupported";
          };
    };
```

Adapter 只有在原生协议直接提供 argv，或能按该协议明确声明的 grammar 无歧义取得单一 invocation 时，才能标为 available。
复合 shell、动态展开、管道或无法确认 quoting 的 source 是 `compound-shell`，不能靠空格 split 伪造 argv。

executable 与 args 保留提交给执行边界的原始 token。
框架不做 basename、wrapper 展开、PATH resolution 或等价命令归一化。

这条边界意味着 `pnpm exec niceeval ...` 的 executable 是 `pnpm`，不是 `niceeval`。
Harness 要证明直接调用 `niceeval` 时，应在用户任务中明确要求直接命令；若允许 wrapper，就应把 wrapper 写成另一条可接受的用户需求，而不是让 core 猜。

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
`calledTool()` 与 `toolOrder()` 都在这组 occurrence 上运行。

orphan finish 没有可信 start、input 或 command classification。
它只能进入协议诊断，不能满足 command selector。

## Actions coverage

Adapter 只有同时满足以下条件，才能声明 `actions: complete`：

1. 原生协议中的全部 action occurrences 都进入标准事件流；
2. 每笔 tool occurrence 都有 command / not-command classification；
3. 原生协议明确提供的 input 全部保留；
4. 没有无法识别的 action kind、丢失的 start 或未交代的截断。

command invocation opaque 不必自动降低整个 actions channel。
它表示 occurrence 集合已知，但依赖 invocation 的 selector 仍可能 unavailable。

Adapter 无法判断 command / not-command 时必须降低 actions coverage。
它不能因为工具名是 `shell`，或 input 含 `command`、`cmd`、`program`、`args` 而宣称 complete。

## Command selector 真值

一笔 occurrence 的 command selector 有三种结果：

| Evidence | Result |
|---|---|
| invocation available，executable、prefix 与 excludes 全满足 | definite match |
| invocation available，任一条件不满足 | definite mismatch |
| invocation opaque | indeterminate |
| not-command | definite mismatch |

`calledTool()` 找到一笔 completed definite match 就可 passed。
没有 definite match，且 actions complete、没有 indeterminate candidate 时 failed；其余是 unavailable。

## `toolOrder()` 顺序

省略 `sequential` 时，`toolOrder()` 保持既有 request subsequence：selector 只按 start 顺序出现，允许无关 occurrence 穿插。

`sequential: true` 使用 distinct completed occurrences，并要求：

```text
A.start ─── A.finish        B.start ─── B.finish
                    <
```

相邻两项满足 `B.start > A.finish`。
相等、交叠、并发或缺少 finish 都不能形成确定链。

算法按 EventPosition 建立候选图：

1. 每个 selector 收集 definite 与 indeterminate candidates；
2. 边只连接 distinct occurrence，并检查严格非重叠；
3. 存在全 definite 完整路径时 passed；
4. opaque 或 partial evidence 仍允许完整路径时 unavailable；
5. required channel complete 且无可行路径时 failed。

Turn 的最终 assistant message 在该 Turn 的 tool loop 结束后产生。
因此 `await t.send()` 返回的 Turn 同时通过 `turn.succeeded()`，且最后一笔 sequential command 已 completed 时，不需要再把 `{ reply: "assistant" }` 作为顺序参数传入。

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

## 完整 Turn Judge 边界

`turn.judge.llm()` 的 current material 由 LLM Judge Runtime 投影。
它包含该轮用户输入、assistant message 和 coverage 允许的行为事件，而不是 `JSON.stringify(turn)`。

Harness 用它关联 `niceeval show` 的 command、stdout、动态 locator、后续 source/execution 调用与最终建议。
Judge 不负责重新判断标准 command 顺序、工具输入路径或 Sandbox diff。

CLI 无法把用户需要的诊断事实显示给 Agent 时，Judge 应失败并指出呈现缺口。
Eval 不能绕过 CLI 读取 `.niceeval` 私有文件，也不能要求 Agent 生成一份专供 Assertion 的 JSON。

## Error classification

以下情况在登记边界同步报告 author error：

- 空 command tuple、空 token、重复 excludes；
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
- command invocation opaque；
- Sandbox permission、transport、timeout 或 terminated；
- diff 内容是 binary 或 oversized，但 Assertion 需要内容。

只有框架、Adapter、provider 或 evaluator 违反自身协议时，Attempt 才 errored。

## 防止 API 膨胀

普通 API 不共享万能 `Rule` 联合，也不提供 `allOf`、`oneOf`、`not` 或 arbitrary predicate。
一个新方法必须满足四个条件：有标准 observation owner、至少两个真实下游、可定义 coverage、无法由现有领域方法清楚表达。

这次只扩展 `ToolSelector`、`toolOrder` options 与既有 `t.sandbox`。
Harness 的输出格式、case 名和评分 rubric 留在用例，不能反向进入 core API。
