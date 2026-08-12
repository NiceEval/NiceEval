# Match

Match 的完整定义在 [Assertions](../../feature/assertions/README.md#共同模型)。它是可复用、不可变、
确定性且无副作用的 value 比较或 evaluator 规则。

Match 不拥有 subject identity、callsite、groupPath、key、label、threshold、score 或 control。作者通过
`t.check(value, match)` 把一次 Match 使用登记成 Assertion，handle 再配置同一 entry。

Boolean Match 可以 refinement 原 subject。连续 Match 返回有限 `[0,1]` measurement：Pass Eval 必须
`.atLeast(n)`，Score Eval 可以 `.score(n)`，也可同时配置局部 threshold。
