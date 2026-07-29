# Attempt 标注源码转换

`toAnnotatedEvalSource(attempt, options)` 读取 AttemptEvidence，
返回普通 `AnnotatedSourceResult`。
`SourceView` 只显示这个值，不读取 sources.json 或 AttemptHandle。

完整源码树见 [Eval source](../../eval-source/README.md)。
