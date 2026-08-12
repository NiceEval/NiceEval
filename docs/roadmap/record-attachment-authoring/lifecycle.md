# RecordAttachment 作者 SDK —— Lifecycle

## Owner

| Context | 生命周期 owner | 可写 definition |
|---|---|---|
| `AttemptRecordContext` | 当前 Attempt draft | 当前 occurrence allowlist 中的 Attempt definition |
| `RunRecordContext` | 当前 Run draft | 当前 occurrence allowlist 中的 Run definition |

Eval body、Eval `before` / `after` 与 Attempt Plugin hook 使用 Attempt context。Experiment `setup` / `teardown` 与
Run Plugin hook 使用 Run context。Group、Report、projector 与 migration converter 没有 runtime record context。

## 从 link 到封口

```text
definition + producer allowlist
  → link owner / duplicate definition
  → create owner context lease
  → lifecycle callback
      record() call
        synchronously reserve family
        start tracked write Promise
  → callback settles
  → after / teardown settles
  → await every tracked write
  → close lease
  → seal Attempt / publish Run
```

Eval `after` 与 Experiment `teardown` 仍在对应 owner 封口前，因此可以写入。进入 close 后，旧 context 的任何调用
都返回 `record-attachment-context-closed`。

## 并发与 duplicate

同一 context 内，第一次调用按 JavaScript 调用顺序原子取得 family reservation。第二次调用即使与第一次并发、
payload 相同或第一次尚未开始 I/O，也稳定返回 duplicate。不存在 last-wins、相同 bytes 去重或“失败后换值重试”。

不同 family 的 writes 可以并发。owner seal 等待所有已启动 Promise；作者漏写 `await` 不会让 write 逃出 owner
Scope。多个 family 失败时按 stable family identity 聚合，不按 Promise 完成顺序选择主错误。中断会中断仍在飞的
writes，并按 Record writer 契约删除未发布临时内容。

allowlist 中的 definition 可以零次 write；一旦调用仍遵守 exactly-once reservation。需要它才能 carry 或发布的
上层 producer contract 另行声明 presence requirement，并在 reuse planning 或 owner 封口前验证。

allowlist duplicate 与 owner mismatch 在 link 阶段失败，不创建 Sandbox、Agent、Run 或 Attempt 资源。

## 失败归属

undeclared、wrong-owner、duplicate、closed、schema encode、closure 与 blob source failure 都是 record command
failure。作者 `await` 时在调用处观察；未 await 时 host 在封口屏障观察。它们不形成 AssertionResult，不修改已经
形成的 Verdict，也不降级为 diagnostic。

callback 未处理的 command failure 进入所属 Eval 或 Experiment lifecycle failure。文件系统、flush、sync 或
complete marker failure继续遵守 Record publication 契约：没有完成标识的 Run 不是已发布事实。host 已接受但未
成功完成的 write 不能被当成缺席事实发布。

migration converter 不使用这些 runtime contexts。它只在 maintenance Scope 内收到旧 value 与 target builder；
失败或中断留下 `migration.in-progress`，由 Git 或用户备份恢复。
