# Failure list

failures page 先用 Sample `filter()` 得到具名范围，再排序、截断 `sample.attempts` 并交给 `AttemptList`。
 limit 与排序写在 page 任务函数里，不成为组件的隐藏数值规则。
