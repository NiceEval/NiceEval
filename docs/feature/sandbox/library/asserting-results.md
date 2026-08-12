# 断言 agent 归因的工作区变化

Sandbox Eval 的 `t.sandbox` 在作者阶段只提供下列 agent-attributed、post-run Assertion
声明。

每一次调用立刻登记一个 Assertion，并返回专用的
`PostRunBooleanAssertionHandle`。

该 handle 只有 `key()`、`label()`、`group()`、`optional()` 与 `gate()` 等 Assertion
配置，不能作为值、不能 `orStop()`，也不存在通用或延迟的 `t.sandbox.diff` subject。

```ts
t.sandbox.changedPaths(["src/index.ts", "src/legacy.ts"]);
t.sandbox.noChanges();

t.sandbox.fileChanged("src/index.ts", {
  status: "modified",
  before: includes("old implementation"),
  after: includes("new implementation"),
});
t.sandbox.fileDeleted("src/legacy.ts");
t.sandbox.notInDiff(/console\.log/, { content: "both" });
```

| API | 判定 |
|---|---|
| `changedPaths(paths)` | 断言所有 agent send-window endpoint delta 的路径构成的无序集合，恰好等于 `paths`。|
| `noChanges()` | `changedPaths([])` 的零路径形式。|
| `fileChanged(path, options?)` | 在至少一个 agent send window 找到该 path 的一个 endpoint delta；`status`、`before` 与 `after` 必须同时满足同一条变化。|
| `fileDeleted(path)` | 找到 agent 归因的 `deleted` endpoint delta；它不声明该文件在 Attempt 最终不存在。|
| `notInDiff(pattern, options?)` | 在变化路径和结构化 changed-hunk corpus 中找不到 pattern。`content` 选 `added`、`removed` 或默认的 `both`。|

变化的归因单位是一次 `t.send()` 的两个端点，而不是 syscall 审计。不同 send 内修改后又还原仍可见；同一 send 内还原到相同端点则没有 delta。`fileChanged()` 的内容 matcher 只读取该候选的 before/after endpoint；内容被 binary 或 oversized elision 取代时，只有依赖该内容的一次匹配会是 `unavailable`。路径和 status 本身仍可确定。

`notInDiff()` 从不扫描未变化上下文。路径命中或已知 added/removed hunk 命中立即为 mismatch；没有命中但所选内容侧存在 binary 或 oversized elision 时为 unavailable。`content` 未参与的路径判定不因 elision 失去确定性。

Runner 在作者 settle 后只导出并冻结一次 `niceeval.diff/v1` Attempt Attachment。它含 agent send-window endpoint attribution、有效 include/ignore/default-policy identity、零变化 window，以及每条路径的 absent/text/elided 端点和 added/removed hunks。所有上述 Assertion evaluator 与该 Attachment writer 持有同一冻结 document。空变化是可用的空 document；采集失败是 unavailable，绝不伪装为空 diff。

required 的 diff Assertion 在 unavailable 时使 Verdict errored；optional 的 unavailable 不单独改变 Verdict。没有声明 diff Assertion 时，采集失败只留下 warning 和 unavailable Attachment，不妨碍其他证据继续。超时或中断先把尚未结算的 Assertion 封为 `producer-interrupted`；之后的 best-effort diff 仅供诊断，不重新决定它。

读取持久化的 typed diff 要通过中立的 RecordAttachment projector：

```ts
import { agentWorkspaceDiffProjectorV1 } from "niceeval";
import { attemptSlotProjection } from "niceeval/projection";

const diffByAttempt = attemptSlotProjection(agentWorkspaceDiffProjectorV1);
```

它没有 Report 或官方组件的特权。未来新增官方 diff Attachment schema 时，必须提供一个逐相邻 converter；diff 与 Assertions 属于同一个 Evaluation migration group，整体迁移或明确呈现 migration-unavailable。
