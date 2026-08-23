# Record 怎么测

契约出处：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [Record → Analysis → Report](../../../feature/record-report/README.md)

Record 单元层只证明可稳定隔离的格式算法和 `recordHost` 边界。真实运行、CLI 读取、Report 接线与用户
可见结果由 [E2E · Record 与 Reports 读面](../e2e/report.md) 验收。

## Fixture 规范

每例在独立 `mkdtemp` 目录写出最小 `niceeval.record.source-receipts`。fixture 显式给出 Record、Run、expected
slot、Member、Attempt identity、Seal manifest，以及九个 fixed family 中被测 family 的 exact payload、owner 与 blob closure。
builder 不代替测试生成决定结果的身份、Member action 或默认状态。

大 payload fixture 使用少量真实 bytes 证明 owner-local blob closure 边界，不签入巨大黄金目录。目录、
JSON 和 blob 内容必须从已发布的 fixed family 形状构造，不能复制 reader 的验证算法作为第二套真相。

## 最小证明面

- **root 与导航**：精确 `{ format: "niceeval.record.source-receipts", recordId }` 可由 `recordHost.openRead()`
  打开；损坏或旧 beta root 产生具名 unsupported/open error。root 没有 numeric schemaVersion。
- **身份与关系**：Attempt 永属 origin Run；Member 只引用已封口 Attempt，`origin | reference` 从关系
  派生，executed/carried/accepted 是 Member action。expected slots 之外的 Member 由 Analysis 标成
  `core-invalid`，不改写分母。
- **固定目录**：九个 fixed family 是封闭联合。Attempt owner 为 Assertions、Agent Turns、Turn Contexts、
  Sandbox Commands、Runner Activities、Runner Diagnostics、File Changes、Artifacts。Run owner 为 Runner
  Activities、Runner Diagnostics、Sources、Artifacts。
  没有作者可调用的 definition、注册、schema name、migration 或任意 JSON writer；未知 family 不会成为可扩展输入。
- **closure**：family 的 exact JSON payload 与 owner-local `blobs/**` 各做一次 round-trip。坏 envelope、
  坏 payload 或坏 closure 形成 `invalid` 并保留 issue；未请求 family 不被读取。
- **source 读取**：同一个 source family 的 available、not-recorded 与 invalid 分别有能区分相邻状态的 fixture。
  collection 的 complete / partial 留在 available payload；unknown 或 future durable bytes 在 session 形成前
  返回 unsupported-format。一项 source 的问题不让无关 source 失效。
- **发布与完成标识**：Core、Attachment、own blobs、Seal manifest 与零字节 `complete` 全部先在 Git 排除的
  staging 中封口，再以同文件系统 no-replace directory publish 同步出现。发布后 Run immutable。
- **恢复**：publish recovery 绑定 staging、destination、Record / Run identity、Seal manifest digest 与完整
  inventory。恢复只重验并重试 publish 或确认已发布 destination，不继续 capture，也不拼接部分 payload。
- **外部损坏**：直接修改已发布 family 或 Core 后，下一次 reader 返回局部 `invalid` / `core-invalid`；
  没有自动修复、revision、history、mirror 或局部 delete 行为。
- **并发边界**：reader 与不同 Run writer 可以并发；maintenance 与它们互斥。reader 可以漏掉刚发布的
  Run，但不能看见部分 Run；不同 root 不协调、不交换 Member，也不自动合并。

## 不这样测

- 不恢复 head、Graph、旧 Results root、revision、proof、mirror 或 SampleBundle fixture。
- 不把 available、not-recorded、invalid、core-invalid、partial 和空值折叠成一态，也不把 unsupported-format
  降成某个 source 的局部状态。
- 不断言私有目录遍历顺序或实现类名，只断言 Host error、公开状态、issue、文件可见边界与 bytes。
- 不在单元层复制完整 Report；Record → Analysis → Report 的权限、次数与静态导出归 Report / E2E owner。
