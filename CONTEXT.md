# NiceEval

NiceEval 保存不可变评估事实，并让分析与报告从同一份事实形成可追溯结果。

## 分析与报告

**Analysis scope**:
从同一份 frozen Record view 选择的 Runs、完整 logical slots 与分母。
_Avoid_: Result set, Query context

**Logical slot**:
由 selected Run 与 slot ID 共同标识的一次样本位置；即使多个位置引用同一个 Attempt，它们仍是不同位置。
_Avoid_: Row ID, Attempt occurrence

**Selected Run**:
建立 logical slot universe、题型与分母的 Run。
_Avoid_: Current Run

**Origin Run**:
最初发布某个 Attempt 的 Run；它只说明 Attempt 的出处，不自动决定当前分析分母。
_Avoid_: Source Run

**Execution claim**:
Attempt 执行完成时保存的评定事实。
_Avoid_: Latest grading

**Grading claim**:
后续 grading Run 对一个 sealed subject 产生的 immutable 评定事实。
_Avoid_: Recomputed verdict, Latest claim

**Grading claim selection**:
在同一 frozen Record view 中显式选择产生 grading claims 的 Runs；它不改变 Analysis scope 的 logical
slots 或分母。
_Avoid_: Latest grading, Analysis selection

**Physical fact package**:
由一个事实权威为一个 Record owner 在同一不可拆 seal transaction 中冻结的 durable facts；它保存
bounded capture algebra、blob closure 与 join anchors，不按某个 Report 想看到的列预先拆分。
_Avoid_: Report table, Logical view, One field per Attachment

**Local projection**:
在同一 frozen Record view 中，将一份 owner-local package 解释为一个或多个 typed views。它不读取
第二份 package，也不建立跨包关系。
_Avoid_: Joined view, Report model

**Fact relation**:
在一个 Analysis scope 内，使用 exact owner 与 durable anchors 把多份 local projections 对齐到
logical slots 的结构关系。它不根据数值容差判定 agreement 或 authority。
_Avoid_: Heuristic join, Metric result

**Derivation**:
从 Sample-aligned facts 或 relations 计算指标、coverage 与领域模型的可选责任。只有 host 管理其
dependency、去重或局部失败时，它才是独立 runtime layer。
_Avoid_: Projection, Page loader
