# `niceeval exp` 把 ID 前缀实现成路径段前缀

**现象（2026-07-16）**：`niceeval exp dev-e2b memory/terminal-swe-bench` 对 `memory/terminal-swe-bench-astropy-1` / `-2` 匹配 0，必须逐条写完整 id；文档一直称位置参数为「eval ID 前缀」。

**根因**：runner 的 `makeFilter()` 与 experiment `evals: string[]` 使用 `id === p || id.startsWith(p + "/")`，实际是路径段选择器；show/view 共用的 `evalPrefixPredicate()` 已明确使用裸 `id.startsWith(prefix)`，并把 `algebra` 命中 `algebra2` 写成契约。同一产品的运行与查看入口长出两套同名语义。

**裁决与修法**：eval ID prefix 全部统一为裸字符串前缀；路径段匹配只保留给 experiment id 的组选择与 `--experiment`。runner/CLI/结果选择共用同一个 predicate，真实 sibling 前缀场景锁回归，不能把公开文档降格成旧实现。
