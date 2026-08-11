# 用公开结果诊断 Assertion

先从 `niceeval show @<locator>` 或 `niceeval view` 打开目标 Attempt。不要根据源码调用顺序猜测 grading；
读取面显示 sealed `AssertionResult`、execution outcome 和对应的 pass 或 score projection。

Pass Attempt 先看 Execution，再看 Verdict 与每个 condition。measurement 会显示实际值和 required threshold。
Score Attempt 先看 Execution 与正式 score，再看评分项：`recorded` 表示没有贡献，`+n` 表示贡献，
`partial score not ranked` 表示不可排名。

若 scope Assertion 不符合预期，核对 `subjectSnapshotRef`：Turn 是不可变结果，Session 是调用点前缀，根 `t`
是已启动 Session 的 vector cut。若 Judge 或 evidence 不可用，读取 Issue 和脱敏原因；不要把它解释为
普通 mismatch 或 `0`。

stop cause 只说明 `.orStop()` 停在了哪个 awaited continuation。它不会生成未执行源码的虚构结果，也不会
撤销此前普通 JavaScript 副作用。
