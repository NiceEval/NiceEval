# Reports 作者模型是三个概念，Composition 是运行期编排

**日期**：2026-07-27

## 裁决

作者模型是 **Source / Composition / Component** 三个概念，不是两个。
`defineComposition((props, ctx) => MaybePromise<ReportNode>)` 拿到当前 page 的 `ctx.input`，
用 `ctx.resolve(source)` 取多个 Source、加工 Content，再返回组件树。它在 resolve 阶段被 await，
不实现 renderer。

`CompositionContext` 只有 `input` / `page` / `signal` / `resolve`，**不含 `record`、主题与
`dimensionPins`**。`ctx.resolve` 只收与本 page 同类型的 Source，所以 `sources.attempt.*`
只能出现在 attempt-input page。`Input` 与 page 的 `input` 不匹配在**装载期**拦，不等到 resolve。

page 级缓存的键是「Source 对象身份 + input 对象身份」，**缓存的是 Promise 而不是完成值**，
所以并发消费者也只算一次、失败由同一个 Promise 广播。Composition 自己不进这份缓存。

页级维度呈现改成句柄制：`dimensions()` 返回 `{ dimension, encoding, values }` 具名声明，
renderer 用 `ctx.dimension(handle).at(index)` 取。`dimensions` 必填。视觉身份是
6 色 × 4 形状变体共 24 槽，色与 variant 同时递进，超过 24 拒绝该页。label 恒在完整 label keyset
上算，visual keyset 只决定槽位。`dimensionPins` 钉的是 `seriesSlot`（1..24）。

## 曾选方案与否决理由

- **把 Composition 记成「进阶装配宏」（本仓 [[report-tree-opens-dual-face-components]] 的原裁决）**：
  否决。render 是纯同步、Component 没有 `resolve`，`await` 在报告树里只有 Composition 一个合法
  产地。降级成装配宏，「取两个 Source 再 join」就没有地方写，而那是第一个非玩具报告就会撞上的
  问题。「只有两个概念」于是成了把复杂度记在账外的话术。
- **`ctx.present(dimension, value)` 按值查**：否决。复合键（`` `${agentId}/${model}` ``）要在
  `dimensions()` 与 renderer 各派生一遍，两处必然分叉。
- **给 Composition 开 `ctx.record`**，让它自行装配 `AttemptEvidence`：否决。那等于 Composition
  能绕过 Source 任意读盘，「Source 是唯一 `.niceeval` 查询接口」当场失效。
- **第 7 个 series 起静默复用颜色**：否决。读者会把两条同色同线型的线读成同一个实验——图在说谎。
  拒绝该页并给 filter / split 两个真实下一步；不建议 `dimensionPins`（pin 不增加容量），
  也不建议「自定义组件用自己的编码」（公开面给不出第 25 个身份）。

## 未定

- **外部业务数据怎样进入报告**没有答案：`ctx.resolve()` 只吃 NiceEval Source，Composition 里的
  外部 IO 会打破 `SitePlan` 字节恒等与 `writeSite` 全或无。候选是禁止 / 构建前确定性快照 /
  显式非确定性标记，倾向快照（它同时管住时钟与随机数）。台账在 `plan/report-authoring-grilling.md`。
- Issue / Notice 分层与 Record 身份（locator 位宽、碰撞语义、`runId`）仍待裁决。
