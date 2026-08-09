# Record：可验证事实根

一次评估会持续产生输入出处、Agent 行为、Sandbox 命令、用量、错误和判断。
这些内容既要支持运行中的 `watch`，也要在结束后供 `show`、`view`、脚本和 Report 复核。
Record 把它们保存成一份长期、可寻址、可验证的事实根，避免运行返回值、磁盘字段和页面数据各自成为真源。

本功能以 Record 作为产品边界。
Observation 只回答“实际发生了什么”，是 Record 中的一类 durable payload。
Record 还拥有 Provenance、Claim、Run、Attempt、内容图、提交事务和证据读取；名称因此指向完整事实对象，而不是其中一种输入。

## 核心心智

`.niceeval` 对应一个 Record。
它可以跨多次 Invocation、多个 Experiment 和多个 Run 追加事实；每次成功提交都会产生一个不可变 `RecordGraphRef`。
默认打开读取最新 head，receipt、Sample 和 Report 则固定到明确的 revision，后续写入不会让既有读结果漂移。
它们保存完整 `RecordGraphRef`，不会按时间、latest 或 most recent 重新挑选结果。

```text
Runner / Agent / Sandbox
          │
          ├─ Provenance：为什么是这次执行
          ├─ Observation：实际发生了什么
          └─ Claim：当时依据哪些事实作出什么判断
                          │
                          v
                 Record durable revision
                    │             │
                    ├─ Live       └─ Sample
                    │                 │
                    └─ Projector ─────┴─> show / view / Report
```

Projection 是 Projector 从固定 Record revision 计算出的读模型。
执行树、时间树、usage、diff、Assertion 和 Verdict 读面都属于 Projection，不进入 Record graph，也不成为下一次判断的事实出处。

## 五条不变量

1. **事实与看法分开。** Provenance、Observation 和 Claim 是权威内容；Projection、snapshot 和 Report artifact 都是可重建读面。
2. **revision 不漂移。** 每个已提交 Graph root 都不可变；完整性由 Stream、Attempt、Run 和 receipt 表达，不给 Graph root 另造 `open` / `sealed` 状态。
3. **引用带完整身份。** 证据、Attempt 和 Projection 都绑定完整 `RecordGraphRef`；采用历史 Attempt 时还绑定具体 adopted node。
4. **依赖显式成图。** typed payload 的每个容器依赖都写成 strong edge；验证、复制、GC 和选择性导出共用一套 walker。
5. **缺口如实保留。** 未采集、未完成、截断、脱敏、损坏和能力不支持是不同状态，不能折成 `null`、空数组或猜测值。

Store 可以先是没有 Layout、head、recordId 和 genesis 的 unbound object namespace。首次成功 CAS
才绑定 Record；之后每个 committed Graph root 都是 immutable durable revision。打开时固定一个
完整 GraphRef，Projection、Sample、Report 和 receipt 都不能悄悄换到后来 head。

## 运行身份与采用关系

Invocation 是一次命令或 Library 调用的 live 聚合身份，不是 durable entity。
每个 Run 恰属一个 Invocation 与一个 Experiment；每个 Attempt 永远归实际创建它的 origin Run。

当前 Run 使用 `RunContribution` 的 membership slot 纳入 Attempt：

```text
Run A（origin） ── owns ──> Attempt X

Run B ── slot ──> Contribution ── adopted revision ──> Attempt X
                    executed | carried | accepted | renamed
```

carry、accept 和 rename 不复制执行事实，也不把 Attempt 改挂到新 Run。
它们创建带依据的 Claim 与 Contribution；迟到事实通过同一 Contribution 的线性 revision 采用同一 Attempt 的后继 revision。
历史 GraphRef 仍看到原来的 Run、Contribution 和 Attempt。

## 信息所有者

| 所有者 | 负责 | 不负责 |
|---|---|---|
| Runner | Invocation、Run、Attempt 生命周期，identity reservation，终态 receipt | 解释 Adapter 私有协议或生成报告字段 |
| Adapter | 把原生 Agent 输出映射成标准行为事件，并声明证据涵盖 | 改写 Runner 生命周期或 Verdict |
| Observation Hub | 校验 envelope、分配顺序并把同一事实交给 durable 与 live sink | 聚合报告指标 |
| Record | 保存 Provenance、Observation、Claim、实体 revision 与强依赖 | 选择 current、聚合指标或排版 |
| Live | 从同一事件流提供 snapshot、tail 与重连 | 成为第二份终态事实源 |
| Sample | 在固定 revision 上选择可比较的 Contribution，并交代涵盖 | 改写历史事实 |
| Projector | 通过可追踪读取产生带依据的 Projection | 写 Record、访问网络、读取未登记状态或手写 EvidenceValue |
| Reports | 计划 Projection、计算指标、渲染并复制实际依据 | 读取原始事件 schema 或反推 Record 字段 |

## 用户任务归属

- [运行中旁路查看](use-case/watch-while-running.md) 读取 LiveRecord，不争用被观察进程的 stdin。
- [从脚本复核事实](use-case/audit-from-script.md) 固定一次 Graph revision，再读取 Provenance、Observation、Claim 或 Projector。
- 收窄可比较范围由 [Sample](../sample/README.md) 负责。
- 构建可分享站点与其它交付物由 [Reports](../reports/README.md) 负责。

## 范围

本功能定义：

- frozen typed-object graph、Record 领域 payload、Merkle catalog 与 locator index；
- durable Observation、Provenance、Claim、RunContribution 与本地证据 target；
- Store 的 fencing、staging、CAS、崩溃恢复、committed root 历史与 GC barrier；
- Agent 增量事件、LiveRecord、Reducer snapshot 和 Invocation receipt；
- 固定 revision 的 Record handle、追踪式 Projector、`EvidenceValue` 两轴状态和 memo identity；
- `watch`、机器输出、locator 寻址、typed mirror snapshot 与选择性证明的职责边界。

本功能不定义 Verdict 词表、Sample 选择算法、Report 页面布局、远程控制面或 OTel collector。
这些 owner 通过 typed payload、Projector 和公开句柄接入，不扩张 frozen core。

`exportSample` 按 phase 直接传播 `RecordSourceError`、`RecordReadError` 或
`RecordEvidenceProofError`。Reports 把底层
`RecordSourceFailure` 或 `RecordEvidenceProofFailure` 包进自己的导出错误，不能把它伪装成 Record
的直接传播。完整镜像先 capture 或 parse typed snapshot；二者只产生 snapshot error，随后 mirror
只产生 mirror error。具体失败词表见 [Library](library.md)。

## 入口

- [Architecture](architecture.md) —— 容器、领域实体、统一证据证明、Store 事务与 GC 不变量。
- [Library](library.md) —— Agent stream、Record 读写、receipt 与 Projector API。
- [CLI](cli.md) —— `watch`、机器输出、locator 与终态审计。
- [Use cases](use-case/README.md) —— 运行中查看与脚本审计的完整路径。
- [Reference](reference/README.md) —— Projector、typed-object graph 与版本防火墙的外部先例。
