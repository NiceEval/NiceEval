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
t.sandbox.changedOnlyWithin(["experiments/local.ts", "docs"]);
t.sandbox.unchangedWithin(["agents/ops-bot.ts", "niceeval.config.ts"]);

t.sandbox.fileChanged("src/index.ts", {
  status: "modified",
  before: includes("old implementation"),
  after: includes("new implementation"),
});
t.sandbox.fileDeleted("src/legacy.ts");
t.sandbox.notInDiff(/console\.log/, { content: "both" });
t.sandbox.inDiff(/it\("rejects an expired token"/, { content: "added" });
```

| API | 判定 |
|---|---|
| `changedPaths(paths)` | 断言所有 agent send-window endpoint delta 的路径构成的无序集合，恰好等于 `paths`。|
| `noChanges()` | `changedPaths([])` 的零路径形式。|
| `changedOnlyWithin(paths)` | 断言每一条 agent send-window endpoint delta 的路径都落在 `paths` 允许的范围内；没有任何变化也满足。|
| `unchangedWithin(paths)` | 断言没有任何 agent send-window endpoint delta 的路径落在 `paths` 的范围内。|
| `fileChanged(path, options?)` | 在至少一个 agent send window 找到该 path 的一个 endpoint delta；`status`、`before` 与 `after` 必须同时满足同一条变化。|
| `fileDeleted(path)` | 找到 agent 归因的 `deleted` endpoint delta；它不声明该文件在 Attempt 最终不存在。|
| `notInDiff(pattern, options?)` | 在变化路径和运行时结构化 changed-hunk corpus 中找不到 pattern。`content` 选 `added`、`removed`、默认的 `both`，或 `none`（只比较变化路径）。|
| `inDiff(pattern, options?)` | 在同一份变化路径与 changed-hunk corpus 中至少找到一处 pattern。`content` 的取值与默认值同 `notInDiff`。|

`changedPaths` 回答“改动恰好是这些文件”，`changedOnlyWithin` 回答“改动没有越出这个范围”。
后者用于授权范围检查：agent 可以不改，也可以只改范围内的一部分。

`changedOnlyWithin` 的每一项是工作区相对路径，按路径组件比较。
变化路径与某一项相等，或位于该项之下，即在范围内：`agents` 允许 `agents/a.ts`，不允许 `agents-old/a.ts`。
它不支持 glob，路径含 `*` 或 `?` 时抛出 `TypeError`；空数组同样抛出，零范围用 `noChanges()`。
归因、`diff.ignore` 与 unavailable 规则和 `changedPaths` 相同。不满足时，诊断列出越界路径的有界预览。

`unchangedWithin` 用于保护区检查：列出的文件和目录不许动，其余随意（[T-25](../../../taste.md#t-25)）。它与 `changedOnlyWithin` 在没有变化时都满足，两者不是逻辑取反。
路径写法、组件比较、空数组与 glob 的拒绝规则都和 `changedOnlyWithin` 相同；不满足时，诊断列出落在保护区内的变化路径。
`changedOnlyWithin` 保持 criterion `sandbox-change-scope/v1`；`unchangedWithin` 使用独立的 `sandbox-unchanged-within/v1`，不扩展已封口的 v1 data。形状见 [Assertions 架构](../../assertions/architecture/README.md#criterion-envelope-与内建-criterion)。

变化的归因单位是一次 `t.send()` 的两个端点，而不是 syscall 审计。不同 send 内修改后又还原仍可见；同一 send 内还原到相同端点则没有 delta。`fileChanged()` 的内容 matcher 只读取该候选的 before/after endpoint；内容被 binary 或 oversized elision 取代时，只有依赖该内容的一次匹配会是 `unavailable`。路径和 status 本身仍可确定。

`notInDiff()` 从不扫描未变化上下文。路径命中或已知 added/removed hunk 命中立即为 mismatch；没有命中但所选内容侧存在 binary 或 oversized elision 时为 unavailable。`content` 未参与的路径判定不因 elision 失去确定性。

只关心文件路径时用 `content: "none"`，例如“子目录里不许出现 package.json 或锁文件”。
它只拿 pattern 与变化路径比较，不读取 hunk，结果不因 binary 或 oversized elision 变成 unavailable；归因材料采集失败或不完整时仍为 unavailable。
默认的 `both` 会连同变化行一起扫描：只写路径的 pattern 遇到某个大文件内容被省略时无法判定，结果是 unavailable 而不是满足。

`inDiff()` 回答“改动里有没有出现这段内容”，不要求事先知道它落在哪个文件；已知路径时用 `fileChanged(path, { after })`（[T-25](../../../taste.md#t-25)）。
它读取的范围、`content` 选项与参数校验都和 `notInDiff()` 相同。路径命中或已知 hunk 命中即为 match；没有命中且所选内容侧存在 elision 时为 unavailable，其余为 mismatch。
两者在 unavailable 时结果相同，所以不是逻辑取反。pattern 同样会与变化路径比较：只想匹配内容时，写一个不会出现在路径里的 pattern。
match 的 Evidence 给出首个命中的路径与有界预览。`inDiff` 使用独立的 criterion `sandbox-in-diff/v1`，不向已封口的 `sandbox-result/v1` 追加 operation。

`content: "none"` 的两种检查都写入独立的 criterion `sandbox-diff-paths/v1`，`content` 为其它值时仍分别写 `sandbox-result/v1` 的 `not-in-diff` 与 `sandbox-in-diff/v1`，已有 Eval 的 criterion bytes 与身份不变。

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

持久化的文件变化由固定 Inspection operation 读取：

```sh
# 先看这次读取的范围，再取结果；单个文件的 diff 用 fc_ 开头的稳定 ID。
niceeval show @<locator> diff --explain
niceeval show @<locator> diff --json
niceeval show @<locator> fc_<id>
```

family 读取只使用 `available`、`not-recorded`、`unsupported` 与 `invalid`。固定 operation 不给 `show` 或 View 任何额外特权，
也不承担 schema migration；格式演进只由 Record maintenance 的相邻 migration 处理。
