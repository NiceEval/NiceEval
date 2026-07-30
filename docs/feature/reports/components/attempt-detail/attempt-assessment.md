# Attempt assessment

Attempt 详情先调用 `toAttemptNotices(attempt)`。
源码可用时调用 `toAnnotatedEvalSource(attempt)` 并交给 SourceView；否则调用 `toAssertionRows(attempt)` 并交给 Table。
