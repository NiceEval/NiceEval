# 把运行事实写入 Record

契约单源始终在 [Record Library](../library.md#高层-record-writer)。
本页只说明不同角色从哪里接入，以及什么时候形成 Provenance、Observation、Claim 或 Projection。

## 先确认自己是不是事实生产者

普通 Eval 作者不创建 `RecordWriter`，也不直接调用 `observe()` 或 `claim()`。
这些入口是 Runner 与第三方 harness 的 producer SPI；Node、edge、radix、sequence、Graph revision 与
CAS 全部由框架管理。

| 角色 | 使用的上层入口 | 不直接处理 |
|---|---|---|
| Eval 作者 | `defineEval()`、Assertions、Judge 与 Sandbox API | RecordWriter、Observation binding、Claim basis |
| Adapter 作者 | [Adapter SDK](../../adapters/sdk/README.md) 的标准行为事件 | Record Graph、stream sequence、Node 或 edge |
| Assertion / Judge / Verdict owner | 各 Feature 的 evaluator 与结果入口 | 任意 JSON Claim、手写 evidence identity |
| 第三方 Runner 或 harness | `createRecordWriter()` 与 Invocation / Run / Attempt lifecycle | 任意 Graph 拼装、head 覆写、手写 digest |
| Report 或分析作者 | Projector、Sample、Calculation 与 Report API | `observe()`、`claim()`、原始 event schema |

Adapter 先把原生 SDK 输出转换成标准行为事件。Observation Hub 再校验 envelope、分配顺序，并把同一
事实交给 durable 与 live sink。Assertion、Judge、Verdict 和 adoption owner 则在自己的领域入口形成
判断；Record 只负责保存它们产生的 Claim。

```text
Eval author ───────────────> Runner lifecycle
Adapter ──> behavior event ──> Observation Hub ──> Observation
Assertion / Judge ──> evaluator + tracked basis ──> Claim
Report / show / view ──> Projector ───────────────> Projection
```

## 四种内容怎样选择

| 内容 | 回答的问题 | 典型例子 |
|---|---|---|
| Provenance | 为什么是这次执行，使用了什么输入 | Eval 源码、Agent 配置、model、价格表 snapshot |
| Observation | producer 实际捕获了什么 | Agent message、tool stdout、exit code、provider usage |
| Claim | 哪个 evaluator 当时依据什么作出什么判断 | Assertion、Judge score、Verdict、估算成本、adoption decision |
| Projection | 固定 revision 现在可以怎样被读取 | timing tree、usage 汇总、diff、pass rate、Report rows |

选择时依次问：

1. 这是外部系统或运行时实际产生的值吗？是则形成 Observation。
2. 这是执行输入、算法、Sandbox 起点、子进程变量集合或 Provider 资源出处吗？是则形成 Provenance。
3. 这是需要保留原 evaluator、版本和依据的历史判断吗？是则形成 Claim。
4. 它能从固定 Record revision 确定性重建，而且只服务读取或显示吗？是则形成 Projection。

不要因为一个计算结果方便查询就把它写成 Claim。能由 Projector 重建的 timing、usage aggregation、
diff 与 Report metric 都留在 Record graph 之外。

## Observation 保存发生的事

Observation 适合有明确 producer、schema 和顺序的运行事件。例如：

- Adapter 收到 Agent message；
- Sandbox command 返回 stdout、stderr 与 exit code；
- provider response 报告实际 token usage；
- workspace collector 捕获文件变化；
- Runner 写入 lifecycle transition 或错误。

同一 stream binding 在 owner 内保持稳定。Runner 或 harness 只建立 binding；writer 补入 scope、分配
sequence、执行 serialization transformation，并生成 Graph revision。Adapter 不生成 streamId、
sequence、NodeRef 或 GraphRef。

如果 provider 返回实际账单，它是 Observation。若 NiceEval 根据价格表计算金额，该金额是 Claim，
因为 evaluator、价格表版本和计算依据都会影响结果。

## Claim 保存当时采用的判断

Claim 不表示绝对真理。它表达的是：某个具名 evaluator 的某个版本，在某个时刻依据一组已提交事实，
产生了一个判断。

典型组合是：

```text
Observation
  Judge request
  Judge 原始 response
        │
        ▼ basedOn
Claim
  evaluator = acme.judge / rubric / 3
  value = { score: 0.8, verdict: "pass" }
```

原始 response 让复核者检查 score 与 Verdict 的规范化是否正确；Claim 则保留运行当时真正采用的值。
以后重新运行 Judge 可能使用不同 model、prompt 或 evaluator version，不能替换历史 Claim。

普通 Assertion、Judge 和 Verdict 使用各自 Feature 的入口。owner 生成 Claim identity、evaluator
与 tracked basis。只有第三方 harness 在实现新的判断 owner 时才直接调用 `RunWriter.claim()` 或
`AttemptWriter.claim()`。它必须提供稳定 Claim id、完整 evaluator identity、已提交 basis 与
`producedAt`，不能用说明文字或未提交对象代替 evidence。

Run adoption 也属于 Claim。carry、accept 与 rename 必须先保存“为什么采用这个 Attempt”的
Run-scoped Claim，再把返回的 `ClaimRef` 交给 `RunWriter.adopt()`。

## 第三方 harness 的职责边界

第三方 harness 使用 [高层 Record writer](../library.md#高层-record-writer) 管理这条顺序：

1. 创建 RecordWriter，并开始 Invocation。
2. 开始 Run，写入本次 Run 的 Provenance。
3. 在外部副作用之前 reserve Attempt identity。
4. 让 Adapter event mapper 把标准行为事件写成 Observation。
5. 让 Assertion、Judge、Verdict 或 adoption owner 写入 Claim。
6. 使用 owner 返回的 `ClaimRef` 完成 Attempt、adopt Contribution 或结束 Run。
7. 完成 Invocation，向上层返回 receipt。

harness 不构造 GraphNode、strong edge、catalog、locator index 或 committed root。它也不自行选择
head、修改历史 revision，或把失败写成 `null`。writer 根据 lifecycle operation 形成事务并执行 CAS；
冲突、closed capability、权限、IO 与 graph violation 使用 Record Library 的 typed failure。

## 常见误用

| 误用 | 正确入口 |
|---|---|
| 把 Judge 原始 response 直接当 Verdict | response 是 Observation；解释结果是带 basis 的 Claim |
| 把 pass rate 写入 Record | 用 Sample + Calculation / Projector 重建 |
| 把 model 配置当作运行事件 | 配置属于 Provenance；provider 实际返回的 model identity 可以是 Observation |
| Adapter 手写 Claim 证明自己成功 | Adapter 只报告行为事实；Assertion 或 Verdict owner 作判断 |
| Report renderer 临时读取 event | 在 plan 中声明 Projector request |
| 调用方传 NodeRef 或自行递增 sequence | 交给 writer 与 Observation Hub |
| 用一段 message 代替 Claim basis | 先提交依据，再引用完整 EvidenceTarget / ClaimRef |

判断仍有歧义时，优先保存最接近 producer 的 Observation，并把可重建解释留给 Projector。只有需要
保留“当时实际采用了这个判断”时，才新增 Claim。

## 接下来进入哪里

- 编写或接入 Agent：进入 [Adapter SDK](../../adapters/sdk/README.md)。
- 定义检查：进入 [Assertions](../../assertions/README.md)。
- 使用模型裁判：进入 [Judge Library](../../judge/library.md)。
- 折叠终态：进入 [Verdict](../../verdict/README.md)。
- 从固定事实构造读模型：进入 [追踪式 Projector](../library.md#追踪式-projector)。
- 选择可比较成员：进入 [Sample](../../sample/README.md)。
- 构建终端或网页交付：进入 [Reports](../../reports/README.md)。
