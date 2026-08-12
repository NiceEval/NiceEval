# PLAN-4：3/4 层边界拓扑

本计划是横切 PLAN-1～3 的拓扑裁决轴，不是第四种作者查询语法。它不从类名或目录数量倒推架构。
一个 runtime 责任层只有同时拥有自己的领域对象、不变量、生命周期或
失败边界时才成立；纯查找函数、type alias 与语法糖不算一层。

Record 的 durable bytes 已经固定。它是 L0 存储基底，不计入 runtime 层数。这里比较的是宿主管理的
责任边界：Record reader、Analysis、可选的 managed Derivation，以及 Report delivery。作者可见入口
可以合并或隐藏对象，但不改变这些责任是否存在。

## 共同起点

无论三层还是四层，都必须回答四类职责：

1. 在同一个 frozen view 中读取并迁移 durable facts。
2. 选择 Runs，建立完整 logical slots、origin 对齐与 denominator。
3. 从 facts 派生指标或领域模型，并保留 coverage、state 与 lineage。
4. 把结果交给 Page、PageFamily、Download 或脚本。

争议不在于职责是否存在，而在于第 3 类职责是否需要独立 runtime。如果它只是输入纯值、输出纯值的
TypeScript 函数，就不应为它创建 framework layer；如果宿主必须管理依赖图、跨 consumer 去重、缓存、
错误隔离与 provenance，它就已经是独立层。

## 三层形态：Record → Analysis → Report

```ts
await withRecord({ root }, async (record) => {
  const analysis = await record.select(selection);
  const model = buildQualityModel(await analysis.attemptSlots(fields));
  return renderReport(report, model);
});
```

| 层 | 负责 | 不负责 |
|---|---|---|
| Record | frozen physical read、owner address/schema/migration、blob materialization | population、指标、页面 |
| Analysis | Run selection、base population、logical slots、owner resolution、六态 cells 对齐 | 物理读取、公式执行生命周期、渲染 |
| Report | 调用普通纯函数形成 model，并交付 Pages/Downloads | Record I/O、重新定义 population |

这里的指标库仍可独立发布和复用，但它是纯函数库，不是一个有身份、有 scope 的架构层。PLAN-2 属于
这个形态。

三层的优势是作者路径短、debug stack 普通、脚本与 Report 使用同一批函数。代价是 host 看不到公式
内部依赖，不能自动做 consumer-local failure、跨页面依赖去重或派生级缓存。

## 四层形态：Record → Analysis → Derivation → Report

```ts
const analysis = yield* selectRuns(record, selection);
const quality = derive({ from: attemptFacts(fields), compute: passRate });
const execution = yield* executeReport({ analysis, report: qualityReport(quality) });
```

| 层 | 负责 | 不负责 |
|---|---|---|
| Record | frozen physical read、owner address/schema/migration、blob materialization | population、公式、页面 |
| Analysis | Run selection、immutable base population、logical slots、owner resolution、六态 cells 对齐 | 物理读取、指标公式、交付 |
| Derivation | typed dependency、公式、coverage/lineage、去重、局部失败、具名 subpopulation | 静默替换 base population、渲染 |
| Report | consumer-local data、route identity、Pages/Downloads 与 closed output | 私有 reader、隐式取数 |

四层不是把 `compute.ts` 换个目录。Derivation 必须真的由 host 执行，并产生可观察的依赖、状态与错误
边界；否则这一层只是 ceremony。PLAN-1 属于这个形态。PLAN-3 把 base relations 与 semantic Query
分开，并由 query planner 管理后者，因此也属于四层。

最小 managed Derivation 只要求 typed dependencies、execution-local identity、host scheduling 与局部
失败。Stable id、output Schema 与跨 execution cache 属于扩展能力；只有持久 provenance、独立序列化或
跨 execution 复用成为契约时才强制，不能把全部 ceremony 冒充四层的最低成本。

## 为什么不合并其它边界

- 不合并 Record 与 Analysis：同一 frozen Record 必须能形成多个不同 selection；selection 改变的是
  population 语义，不是 durable facts。
- 不合并 Analysis 与 Report：CLI、notebook 与多个 Report 都要复用相同 logical universe；否则每个
  consumer 都会重新 join，并可能得到不同分母。
- 不把 renderer 继续拆层：Page 与 Download 都只是在同一个 closed result 上交付，当前没有独立数据
  权限或生命周期。

## 裁决条件

先用真实 Report 回答下面的问题，而不是先选数字：

- 是否必须让一个派生失败只阻断依赖它的 consumer？
- 是否需要在不同 Pages/Downloads 间自动去重相同派生？
- 是否需要由 host 输出字段级 dependency 与公式 provenance？
- 是否需要在不知道 Report 实现的情况下规划或缓存派生？

这些问题是评价 gate，不是当前已经回答的共同契约。只要其中一项被升为产品契约，就选四层；如果全部
只是优化愿望，选三层，把指标留作普通纯函数。不能一边
采用三层 API，一边偷偷在 Report loader 内重建不可见的 Derivation runtime。

## Cases

- C1、C2、C5、C6、C9 检验 Record 与 Analysis 是否真正分离。
- C3、C4a、C4b、C12 检验 Derivation 是否拥有独立语义，还是只是函数库。
- C7、C8 检验 Report 是否只负责交付且没有官方私有通道。
- C10 检验三层与四层都能脱离 UI 复用。
- C11 仍受完整 blob snapshot 限制，增加层数不会创造选择性 reader。

## 入口

- [Library](library.md)：三层与四层的最小公开形状。
- [Architecture](architecture.md)：层的成立标准、依赖方向与禁止泄漏。
- [Attempt detail](use-case/attempt-details.md)：同一用例在两种层数下的路径。
