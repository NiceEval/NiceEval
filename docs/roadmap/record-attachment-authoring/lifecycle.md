# RecordAttachment 作者 API —— Lifecycle

## Owner 与 occurrence

| Lifecycle occurrence | context | 可写 definition |
|---|---|---|
| Eval author、每个 Eval Plugin | 当前 Attempt 的 `AttemptRecordContext` | 本 occurrence `write` 中的 Attempt definitions |
| Experiment author、每个 Experiment Plugin | 当前 Run 的 `RunRecordContext` | 本 occurrence `write` 中的 Run definitions |
| framework built-in producer | 对应 owner 的内部同形 context | package-private grant 中的 official definitions |
| Group、Sandbox provider、Agent、Adapter、Report、projector、converter | 无通用 record context | 无 |

所有 occurrence 共享 owner 的一次性 `(owner, name)` reservation table，但各自持有独立 grant 和独立 open / closed
状态。一个 Plugin 不能从 context 枚举或使用作者、其它 Plugin 或 framework 的 definitions。

Eval `before` / body / `after` 都发生在 Attempt 封口前。Experiment `setup` / selected pairs / `teardown` 都发生在 Run
封口前。进入过的 teardown / after 仍按所属 host 的 Scope 规则运行；是否能写只取决于该 occurrence grant 与 owner
是否仍在允许 admission 的阶段。

## Link 在资源之前完成

```text
definitions + application install + producer write declarations
  → compile every definition
  → validate owner of each occurrence grant
  → reject duplicate (owner, name) across occurrences
  → construct immutable link plan
  → only then create Run / Sandbox / Agent / Attempt resources
```

owner mismatch、伪造 definition、重复 family 或 Plugin occurrence conflict 都是零资源 link failure。application install
可以包含同一个 definition，但它属于读取与 migration registry，不参与 writer duplicate 检查，也不会补齐 producer
grant。

## 一次 `record()` 调用的 linearization point

`record()` 是 eager Promise command。调用发生的同一 JavaScript turn、在函数把 Promise 交回作者之前，host 完成：

1. 检查 owner lease 仍为 `Open`；
2. 检查 definition owner 与 context owner 相同；
3. 用 exact object identity 检查 occurrence write grant；
4. 原子 reserve `(owner, name)`；
5. 同步运行 payload / blob builder，并捕获 package-owned encoded snapshot；
6. 把成功或失败 command 登记到 owner 的 tracked command set。

因此以下代码的调用顺序已经确定 reservation，与作者是否立即 `await` 无关：

```ts
const first = ctx.record(metric, { value: 1 });
const second = ctx.record(metric, { value: 2 });

await Promise.allSettled([first, second]);
```

`first` 保留 family；`second` 稳定拒绝 duplicate。第一次的 blob I/O 尚未开始、最终失败，或两个 payload bytes 相同，
都不会释放 reservation、改成 last-wins 或允许替换。不同 family 的 commands 可以并发。

同步 admission / snapshot validation 的失败也先变成一个已登记的 failed command，再由返回 Promise 让作者观察；它不以
未追踪的 raw throw 逃出 owner barrier。dynamic definition 本身则更早在 `defineRecordAttachment()` 边界同步抛出
`RecordAttachmentDefinitionError`，根本不能进入 link。

## Poison 语义

owner 在 Open 期接受过的任一 record command 只要失败，就 poison 该 owner：

```text
command failed
  ├─ awaited / caught      → 作者在调用点观察同一失败
  └─ not awaited           → host 在 drain 时观察同一失败
                         both
                           ▼
                    owner cannot publish
```

catch 只表示作者已经观察 rejection，不是撤销 write。undeclared、wrong-owner、closed、duplicate、payload、plain-data、
closure、blob source、I/O 与 interruption 都不能降级为“Attachment 缺席后继续发布”。它们也不形成 AssertionResult、
不修改已经形成的 Verdict，并且不靠 diagnostic 掩盖。

多个 family 失败时，owner 保留全部 failures，并按稳定 family identity 形成公开顺序；Promise / Stream 完成竞速不决定
哪一个成为主错误。callback 自己的 failure 与 record failures 继续按所属 Eval / Experiment lifecycle 的 Cause 组合规则
封口。

## 正确的封口顺序

owner 不能先等待 commands、再关闭 admission；否则一个旧 context 可以在 wait 观察“当前为空”之后登记新 command。
完整顺序是：

```text
all external lifecycle callbacks settle
  → close every external occurrence grant
  → drain their tracked commands
  → form Plugin contribution provenance from successful accepted events
  → framework built-in grant writes provenance / remaining official facts
  → close framework grants
  → atomically transition owner Open → Closing
  → drain owner tracked command set to quiescence
  → if poisoned: fail publication
  → transition Closing → Closed
  → seal Attempt / flush Run / create publication marker
```

关闭 external grant 后，该 Plugin 或作者保存的旧 context 立即返回
`record-attachment-context-closed`；owner 暂时仍为 Open，只为 framework 的 package-private grants 完成收尾事实。framework
grants 关闭后，`Open → Closing` 是 owner-wide admission barrier；此后任何 grant 都不能登记 command。最终 drain 包括
framework 写入，并确认 tracked set 已静止。

Plugin provenance 只引用 generic writer 已完整成功后发出的 accepted events。reserve、调用、payload capture 或局部 blob
写入都不是 accepted。provenance 自己通过普通 built-in grant / context 写入；它的 accepted event 不递归进入本次
provenance document。

Attempt 只有在自己的 writes 全部成功后才能成为可封口事实。Run 只有在所有 owned facts、Attempt references 与 Run
attachments 全部成功并 flush 后，才最后创建 `complete`；没有完成标识的目录不是 published Run。

## 中断与资源释放

所有 record commands 都属于 owner 的同一个 Effect 3 Scope bridge。中断 owner 会中断仍在飞的 blob Streams 与 writes，
等待其 finalizers，并按 Record writer 契约关闭 handle、删除未发布临时内容或留下可由 `niceeval clean` 识别的 incomplete
Run。Promise facade 不启动 detached runtime，因此不存在 host 已结束但 write 仍在背景运行的成功路径。

中断保持 Effect Cause，不改写成 payload invalid、missing Attachment 或普通 data state。作者 callback 即使捕获自己的
Promise rejection，也不能清除 owner 的 poison 状态；只有从未 accepted 该 command 的更早 link failure 才是零 owner
资源失败。

## 读取与迁移不是 runtime write lifecycle

reader 在 frozen view 内 materialize `RecordAttachmentValue`；它没有 write lease，也不会自动运行 converter。projector
只同步解释这个 immutable value。

migration 在 exclusive maintenance Scope 内运行：先创建并 sync `migration.in-progress`，再逐 adjacent edge 调用
converter，最后由 maintenance committer 写入并 sync portable bytes。converter 只持有 source value 与 target builder，
不持有 Eval / Experiment / Plugin context。failure、defect 或 interruption留下 sentinel；它不能回到 runtime
`ctx.record()` 重试或发布新 owner。
