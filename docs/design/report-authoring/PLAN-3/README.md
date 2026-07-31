# 方案 3：通用原语 + SQL 取数

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-4](../PLAN-4/README.md) · [DECISION](../DECISION.md)

---

## 方案

保留通用原语，把数据源换成查询。
树解析阶段把 Record 全量加载成 attempts、evals、runs 等表，执行作者写的 SQL，行集交给原语渲染。

```tsx
import { Table, defineReport, sql } from "niceeval/report";

export default defineReport(
  <Table source={sql`
    select agent,
           avg(passed) as pass_rate,
           sum(cost_usd) as cost
    from attempts
    group by agent
    order by pass_rate desc
  `} />,
);
```

复用与外壳的 `sources` 字段同构，这一点直接学 Evidence.dev 的命名查询：

```tsx
export default defineReport({
  sources: {
    byAgent: sql`select agent, avg(passed) as pass_rate from attempts group by 1`,
  },
  pages: [
    page("overview", <Table source="byAgent" />),
    page("detail", <Chart source="byAgent" x="agent" y="pass_rate" />),
  ],
});
```

落地要选一个引擎：DuckDB、SQLite，或自己实现一个 SQL 子集。
前两者给作者完整方言，代价是把原生依赖装进一个当前只发 TypeScript 源码的包；自研子集避开依赖，但作者写的是一个受限方言，不是他会的那个 SQL。

---

## 优势

- **需求 8 的另一种答法。
  ** 提问不必先在库里存在对应能力，想到什么查什么，探索性分析即写即得。
- **关联与窗口是一等写法。
  ** 「每个 agent 上最差的三道题」一句就能写：

  ```sql
  select * from (
    select agent, eval_id, avg(passed) as v,
           row_number() over (partition by agent order by avg(passed)) as rk
    from attempts group by 1, 2
  ) where rk <= 3
  ```

同一件事在 [PLAN-2](../PLAN-2/README.md) 里要先 `compute()` 再用普通 JavaScript
分组、排序、截断，代码更长。
- **迁移成本低。
  ** 会 SQL 的人不学新词汇；查询可以直接搬去外部 BI 工具复用。
- **库的公开面变小。
  ** 不必导出 `Measure`、`Dimension`、`RowSource` 这些类型。

---

## 缺点

四条缺点各自独立，任何一条都不能靠文档纪律补上。

### 两级聚合退回作者手上

上面那段 `avg(passed)` 是错的。
它把全部 attempt 摊平，重试三次的题在结果里的权重是只跑一次的题的三倍。
正确写法要嵌一层：

```sql
with per_eval as (
  select agent, experiment_id, eval_id, avg(passed) as v
  from attempts
  group by 1, 2, 3
)
select agent, avg(v) as pass_rate
from per_eval
group by agent
```

两个查询都返回一个介于 0 和 1 之间、看起来完全正常的数。
类型系统拦不住，测试也拦不住——只有知道口径的人逐句读查询才发现。
需求 1 因此从「结构保证」降级成「作者自觉」。

### 证据引用变成可选项

聚合结果是标量。
要下钻回 attempt，作者得自己收集定位符：

```sql
select agent,
       avg(v) as pass_rate,
       array_agg(locator) as refs        -- 忘了写就没有下钻
from per_eval
group by agent
```

还要自己分清两个计数：

```sql
count(v)    as samples,   -- 读数非空的样本
count(*)    as total      -- 这一格覆盖的全部 attempt
```

需求 5、6 全靠这三列写不写。
而报告最有用的动作恰恰是从一个可疑的数字点进证据。

### artifact 摊不平

`assistantTurns` 要读 `o11y.json`，`changedLines` 要读 diff。
这些 artifact 逐 attempt 懒加载，单个可达数百 MB。
放入表只有两条路：树解析前从磁盘全量读入内存，或者提供 UDF。

```sql
select agent, avg(changed_lines(locator)) from attempts group by 1
```

全量读取违反需求 17；UDF 等于把 [PLAN-2](../PLAN-2/README.md) 的 `Measure.value` 包了一层 SQL 语法，还失去了 `where`、`aggregate` 与 `null` 语义。

### 列的元数据无处安放

单位、越高越好、双语标签与格式化在 SQL 里没有位置。
它们只能挪到查询旁边：

```tsx
<Table source={sql`…`} columns={{
  pass_rate: { label: { en: "Pass rate", "zh-CN": "通过率" }, better: "higher" },
  cost: { label: { en: "Cost", "zh-CN": "成本" }, unit: "USD", better: "lower" },
}} />
```

于是一个读数的定义散在两处，改列名要同时改两处，而需求 12 要的是「只声明一次」。
同一个 `cost` 在另一页的另一段 SQL 旁边还要再写一遍这张表。

### 其它代价

- **类型不进 TS。
  ** 列名拼错、`select` 少一列，都要等运行时才炸。
- **引擎进包。
  ** DuckDB 与 SQLite 都要装原生依赖或 wasm，影响安装耗时；自研子集则要自己实现窗口函数与报错。
- **口径漂移无从检测。
  ** 官方数字来自 `Measure`，作者页面的数字来自各自的查询，两边对不上时没有单点可查。

---

## 数据流

```text
.niceeval/ ──▶ 全量加载 attempts / evals / runs 表 ──▶ SQL 引擎 ──▶ 行集 ──┬── text 面
                          ▲                                          └── web 面
                          │
                    artifact 只能全量加载或走 UDF
```

全量加载就是这个方案的成本所在：它要在树解析前决定读多少磁盘，而 [PLAN-2](../PLAN-2/README.md) 把这个决定留给每个读数自己。

---

## 验收

1. **默认正确**：作者按直觉写下的第一版查询给出正确权重的通过率。
   本方案做不到——直觉写法是摊平的 `avg`。
2. **证据可达**：任一聚合格能点进它覆盖的 attempt。
   本方案要看作者写没写 `array_agg`。
3. **读数只声明一次**：同一个成本列在两页上单位与方向一致。
   本方案要看两段 SQL 旁边的元数据表是否抄一致。
4. **大 artifact 不拖垮树解析**：只读实际用到的 diff。
   本方案在 UDF 形态下勉强成立，在树解析前全量加载的形态下不成立。

**反指标**：拿一份只有单次 attempt 的结果验收。
这时摊平的 `avg` 与嵌套的 `avg` 得到同一个数，两级聚合的缺陷完全不显形——而真实实验几乎都跑多轮。

---

## 与其它方案的关系

- **vs [PLAN-2](../PLAN-2/README.md)**：自由度与默认正确的直接交换。
  SQL 赢在能问任何问题，输在容易问出一个看起来对的错问题。
- **vs [PLAN-4](../PLAN-4/README.md)**：PLAN-4 只把 SQL 当逃生舱，官方数字仍走数据源，因此上面四条缺点只作用于作者显式选择 SQL 的那些格子。
- **vs [PLAN-1](../PLAN-1/README.md)**：两个极端，见 PLAN-1 的同名小节。
