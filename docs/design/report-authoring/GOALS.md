# 目标与要求

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md) · [DECISION](DECISION.md)

---

## 目的

定下报告作者面的两件事：组件的粒度，以及作者从哪里拿到数字。

作者面涵盖 `niceeval/report` 导出的计算函数、结果转换、组件，以及作者在报告文件里写下的 page。
它不涵盖具体业务读数口径，也不涵盖宿主怎么选 Sample。

判断标准只有一条：**读者看到的数字要能被复算、能回到证据**，而这件事的成本不该全压在写报告的人身上。

---

## 设计原则

- **官方数字与自定义页共用同一段计算。**
  两条口径迟早给出两个数，而报告的用处正建立在数字可复算之上。
- **数字必须能回到证据。**
  每个读数格保留有效样本数、涵盖总数和它涵盖的全部 attempt 引用。
- **一份声明同时出 text 与 web 两面。**
  只有一面能读的能力不进作者面。
- **Analysis execution 只返回进程内 closed values。**
  `aggregate()` 通过受限 `ReportSample` 请求 fields；`ReportExecution` 的 closed semantic tree 才进入 renderer。浏览器包不含
  磁盘读取、结果根或查询引擎。
- **自由度可枚举。**
  报告树是声明式结构，不是能求值的表达式语言。
- **作者不必等库。**
  调整默认呈现的路径不能是「提 issue 加一个 prop」。

---

## 需求

### 正确性

1. 两级聚合由可复用的具名纯函数明确实现：同一 experiment × eval 的多个 attempt 先折成题级值，再跨题折成终值。
   Report host 不按 entry 数或 transport coverage 猜这个权重。
2. 「测不了」（读数返回 `null`）与「没跑到」（涵盖缺口）在同一张表里区分得开。
3. 跨 Run 计算先按 Record 的 attempt 身份键去重。
4. 计算失败与缺数据严格分开：Analysis materializer defect／problem 形成 execution failure／problem，不伪装成测不了。

### 可追溯

5. 任何聚合数字都能列出它涵盖的 attempt，包括读数为 `null` 的那几条。
6. 涵盖缺口以占位行或缺失格出现，不静默消失成空白。
7. 一次 attempt 的证据下钻只有一个入口，不为「一个点对应多个 attempt」另发明回调。

### 可学习

8. 常见问题一行取到默认装配：实验对比、成绩单、稳定性、成本与质量。
9. 改默认列或默认排序不换组件，也不等库加 prop。
10. 作者读一个 API 的文档就能推断另一个：同名参数在不同位置语义一致。

### 一致性

11. 同一个读数在图、表与摘要里同值。
12. 单位、优化方向与格式化等数值语义只在具名 Measure 中声明一次；双语 label 留在组件呈现面。
13. 同一个维度值在一页里恒定一个颜色。

### 扩展性

14. 作者与官方使用同一套 Analysis fields、`aggregate()` executor 与 closed semantic components。
15. 新增一种渲染形状要有判据，不能因为「这个数据源画出来长得不一样」就加原语。

### 交付

16. web 面无 JavaScript 即完整可读；浏览器包不引入查询引擎或运行时依赖。
17. 事实 I/O 只通过 `aggregate()` 的 host executor 发生；Page / component callback 只取得受限 `ReportSample` 与 closed rows，
    renderer 只消费 closed semantic tree。
18. 相同 semantic tree 与同一 renderer 版本产出字节级稳定的静态输出。

---

## 不是本 doc 的目标

- **读数口径本身。**
  `passRate` 怎么算、超时怎么记删失，归 [Analysis Measure](../../roadmap/record-analysis-report/library.md#在-population-上定义-fields)。
- **Sample 选择。**
  哪些 attempt 进入这次比较，归 [Sample](../../feature/sample/README.md)。
- **主题与 CSS。**
  报告长什么样归 [主题](../../feature/reports/README.md)。
- **宿主 flag 与寻址。**
  `show` 的切片、`view` 的路由归 [Reports 架构](../../feature/reports/README.md)。
- **把结果交给外部工具。**
  想用 pandas 或 BI 查结果，走 [Record](../../feature/record/library.md) 的读取面与 `exportSample`，不需要报告面提供查询语言。
