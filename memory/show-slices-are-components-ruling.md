# 裁决:show 切片收敛为报告组件装配,`--json` = resolve 产物信封(2026-07-23)

**裁决**:show 的切片不再是「宿主证据投影」独立管线,每个切片解析为报告组件的装配,`--json` 输出该视图组件 resolve 产物的信封包装——「text 面与 JSON 共有派生字段同值」由构造保证(同一次 resolve),不再是两套手写投影间的纪律。组件归属:对照矩阵 = `DeltaTable` 升级多条件(不另造新名);`--stats` = `StabilityMatrix`;`--usage` = `UsageTable`(与 attempt 首页 `usage:` 行共享组装口径);证据切片(`--source`/`--execution`/`--timing`/`--diff`)= attempt-detail 组件族区块的 text 面,预览预算 / `--expand` / `--grep` 是 text 渲染选项,JSON 面恒全量(「--expand 与 --json 互斥」从特判变推论)。宿主保留的只有机器:flag 解析、逐 attempt 分节映射、text 渲染。`show/json.md` 只留信封与指针,逐视图形状单源迁各组件分篇的 `*Data` 声明。落 docs:`docs/feature/reports/architecture.md#show-的切片是组件选择`;分篇传播见 `plan/evidence-registry-slice-components.md`。

**起因**:show 三轴定稿(见 [[show-scope-slice-json-ruling]])后出现三组平行实现——compare 矩阵 vs `DeltaTable`、`--stats` vs `MetricMatrix` 配方、`--usage` vs attempt-detail Usage 组件;`show --json` 又手写第三套逐视图形状;而组件模型本已提供「text/web 消费同一次 resolve 产物」的构造保证,切片管线绕开了它。

**曾选方案与否决理由**:

- 保留「宿主证据投影」类目——否决:与「宿主保留的只有机器」原则冲突,每加一个切片 text/json 双写、终端与报告库双实现。
- 对照另造 `CompareMatrix` 新组件——否决:`DeltaTable` 的语义就是配对对照,多条件是自然推广,一个语义一个名字。
- `--report` 与 `--json` 解除互斥(任意报告树输出 data)——维持互斥:报告树是「怎么看」,`--json` 是「是什么」;自定义结构走 `--json` 后加工或 results 库读取面。
