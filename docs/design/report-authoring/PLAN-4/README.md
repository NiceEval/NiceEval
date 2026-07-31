# 方案 4：类型化数据源 + SQL 逃生舱

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

---

## 方案

默认写法与 [PLAN-2](../PLAN-2/README.md) 完全相同，官方数字全部走数据源。
额外导出一个 `sql()` 数据源工厂，作者遇到官方目录答不了的问题时落到它。

```tsx
// 日常：走数据源，口径与默认报告同源
<Table source={measureRows({ rows: "agent", measures: [passRate, costUSD] })} />

// 逃生：官方目录里没有的提问
<Table source={sql`
  select agent, eval_id, count(*) as tries
  from attempts
  where verdict = 'errored'
  group by 1, 2
  having count(*) > 3
`} />
```

`sql()` 返回的仍是一个 `DataSource`，因此它能进外壳的 `sources` 字段、能被 `compute()` 手工调用、能交给任何吃 `TableContent` 的原语。
作者面只多一个名字。

---

## 两种逃生舱形态

### 4a：SQL 查 Record 全量加载表

查询面与 [PLAN-3](../PLAN-3/README.md) 相同，区别是它只是入口之一。
好处是逃生舱确实能答任何问题；代价是 PLAN-3 的四条缺点原样保留，只作用于作者显式写 SQL 的那些格子。

### 4b：SQL 只查已算好的 Content

把 SQL 限制成对数据源产物的二次投影，口径仍住在 `Measure` 里：

```tsx
const byAgent = measureRows({ rows: "agent", measures: [passRate, costUSD] });

<Table source={sql`select * from ${byAgent} where cost > 5 order by pass_rate desc`} />
```

这个形态保住了两级聚合与读数元数据，但它能做的事恰好是 [PLAN-2](../PLAN-2/README.md) 里「先 `compute()` 再用普通 JavaScript 加工」已经能做的事：

```tsx
const content = await byAgent.compute(ctx.sample);
const rows = content.rows
  .filter((r) => Number(r.cells.cost.value) > 5)
  .sort((a, b) => Number(b.cells.passRate.value) - Number(a.cells.passRate.value));
```

JavaScript 版本多两行，换来类型检查、编辑器补全与断点。
4b 因此是一个引擎依赖换两行代码的交易。

---

## 优势

- **需求 8 得到两条路径。**
  常见提问一行取到，长尾提问不必等库加一个数据源。
- **官方数字不受影响。**
  默认报告、摘要与散点仍走 `Measure`，需求 1 到 7 在官方面上仍由数据形状强制。
- **逃生舱可以逐步收编。**
  某段 SQL 被反复写，就说明该问题值得做成一个具名数据源。

---

## 缺点

- **两条口径入口同时存在。**
  同一页上一个数来自 `passRate`，另一个来自作者的 `avg(passed)`，两个数不一致时读者无从判断谁对。
  需求 11 从结构保证降级成「取决于作者选了哪条路」。
- **不变量降级成建议。**
  「数字能回到证据」在数据源侧是必然，在 SQL 侧是可选。
  一份契约里同一条规则有两种强度，实际效果是较弱的那种成为事实标准。
- **文档要写两遍。**
  每个概念都要说明它在数据源侧怎么做、在 SQL 侧怎么做，而读者最常问的问题会变成「我该用哪条」。
- **引擎依赖没省下。**
  4a 要装引擎，4b 也要装，只是使用频率低——安装耗时与包体积按是否引入计算，不按使用频率。
- **收编方向会反向。**
  逃生舱好用时作者不会回头提数据源需求，官方目录因此停止生长，而每份报告各自维护一段查询。

---

## 数据流

```text
Sample ──┬── 数据源 compute() ────────▶ Content ──┬── text 面
         └── sql() ── 全量加载表 ── 引擎 ──▶ 行集 ────┘
```

两条竖线汇进同一批原语，但它们保证的东西不同：上面一条带着覆盖率与证据，下面一条带着作者写下的列。

---

## 验收

1. **官方数字不受影响**：默认报告与摘要仍走 `Measure`。
   本方案满足。
2. **一页内数字自洽**：同一页上两个通过率一致。
   本方案不保证——取决于作者的查询怎么写。
3. **不引入新依赖**：本方案不满足，4a 与 4b 都要引擎。
4. **一条规则一种强度**：证据下钻在整份契约里同样是必须的。
   本方案不满足。

**反指标**：把 `sql()` 写进文档的「高级用法」小节，并声明「官方数字请用数据源」。
这句声明不改变任何机器行为，读者按自己顺手的方式选，最终两种数字混在同一份报告里。

---

## 与其它方案的关系

- **vs [PLAN-2](../PLAN-2/README.md)**：多一个逃生舱，代价是多一条口径入口与一个引擎依赖。
- **vs [PLAN-3](../PLAN-3/README.md)**：把 SQL 的缺点限制在作者显式选择的位置，同时也把 SQL 的优势限制在同一批位置。
- **vs [PLAN-1](../PLAN-1/README.md)**：两者都在默认之外留了口子，但 PLAN-1 的口子是 props，PLAN-4 的口子是另一种语言。
