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
| `notInDiff(pattern, options?)` | 在变化路径和运行时结构化 changed-hunk corpus 中找不到 pattern。`content` 选 `added`、`removed` 或默认的 `both`。|

变化的归因单位是一次 `t.send()` 的两个端点，而不是 syscall 审计。不同 send 内修改后又还原仍可见；同一 send 内还原到相同端点则没有 delta。`fileChanged()` 的内容 matcher 只读取该候选的 before/after endpoint；内容被 binary 或 oversized elision 取代时，只有依赖该内容的一次匹配会是 `unavailable`。路径和 status 本身仍可确定。

`notInDiff()` 从不扫描未变化上下文。路径命中或已知 added/removed hunk 命中立即为 mismatch；没有命中但所选内容侧存在 binary 或 oversized elision 时为 unavailable。`content` 未参与的路径判定不因 elision 失去确定性。

Runner 在作者 settle 后只导出并冻结一次 workspace diff 语义值。它是 Assertion evaluator 与 FileChanges collector
共享的内存输入。封口时 collector 以归因策略、采集状态和按顺序排列的 send 区间端点轨迹形成 origin Attempt 的
`niceeval.file-changes` closure；其 persistence revision 是 `2`。它不是另一种 diff schema。

运行时的 changed-hunk corpus 只服务 `notInDiff()` 求值和该 Assertion 自己的 Evidence。持久 File Changes 不保存
hunk、patch、跨区间 path 汇总或 `net`。它保留 agent send 区间端点归因、有效 include/ignore/default-policy identity、
零变化 send 区间，以及判定所需的路径与 revision endpoint。

持久化的 path、revision、`elided` 内容与 blob 只以 File Changes 的 exact decoder 为准。Assertion 的 result、
coverage 与 Evidence refs 则只封入 Assertions，不会复制到 File Changes。

完整空轨迹是 `collection.state: "complete"` 的可用值。已启动采集失败、中断或达到限额时，collector 写
`collection.state: "partial"`、limitation 和安全前缀；这个前缀可以为空。只有 collector 不适用时，File Changes
才是 `not-recorded`。required 的 diff Assertion 在其证据输入为 `unavailable` 时使 Verdict `errored`；optional 的
`unavailable` 不单独改变 Verdict。超时或中断先把尚未结算的 Assertion 封为 `producer-interrupted`；之后已封口的
partial 轨迹仅供诊断，不重新决定它。

持久化的文件变化通过 Analysis 的闭合 DomainView 读取：

```ts
import { fileChangesView, query } from "niceeval/analysis";

const diffByAttempt = await query(sample, {
  kind: "domain-view",
  view: fileChangesView,
  locator,
});
```

family 读取只使用 `available`、`not-recorded`、`unsupported` 与 `invalid`。这条查询没有 Report 或官方组件的特权，
也不承担 schema migration；格式演进只由 Record maintenance 的相邻 migration 处理。
