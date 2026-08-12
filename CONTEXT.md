# NiceEval

NiceEval 保存不可变评估事实，并让分析与报告从同一份事实形成可追溯结果。

## Report 查询

**ReportQuery**:
Report 对一份 frozen selection 的静态取数或同步派生声明。作者可以组合和消费它，但不能直接执行它。
_Avoid_: Source, Projection, Calculation object

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
