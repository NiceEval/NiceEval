# 升级 NiceEval 后沿用已有结果

升级 NiceEval 本身不改变任务、模型或判据，已付费的结果应继续计入当前成绩。
NiceEval 改变身份计算时必须更换 domain，并登记具名变更；用户从 dry plan 就能看出哪些结果沿用、哪些必须重跑。
规则见[身份域变更](../architecture/cache.md#niceeval-身份域变更)。

升级后先预览，不花钱：

```sh
niceeval exp compare/codex --dry
```

```text
PLAN
compare/codex  memory/commit0  Attempt #1  using result @1K1P0VJAPVJ12 — via fingerprint-algorithm/3-to-4
compare/codex  memory/commit1  Attempt #1  will run — identity domain changed: opensandbox-prepare/1-to-2 (behavior-changing)
compare/codex  memory/commit2  Attempt #1  will run — configuration changed: config:judge.model (gpt-5.6 → gpt-5.6-sol)
3 targets · 1 reused · 2 to run
```

三行对应三种情况：

- 第一行的变更是 `encoding-only`：只改了身份的编码方式。NiceEval 用旧算法从当前输入重算，结果与历史 digest 逐字相等，因此直接沿用同一 locator。不需要 `accept`，也不写入新的资格事实。
- 第二行的变更是 `behavior-changing`。新版本实际执行的内容不同，旧结果只能在历史中查看；`accept` 同样拒绝，dry 不给采用建议。
- 第三行是用户自己的配置变化，与升级无关，按[修改运行条件](cache-modify-runtime-condition.md)处理。

`--dry --json` 在对应位置给出同一判断：沿用位置的 explanation 为 `match`，`via` 列出变更名；
缺口位置为 `unexplained`，code `identity-domain-changed`，facts 含变更名、`kind`、`from`、`to` 与 effect。

决定是否补跑前，按 code 区分责任：

| dry 显示 | 含义 | 处理 |
|---|---|---|
| `via` 变更名 | `encoding-only` 变更，已沿用 | 无需操作 |
| `identity-domain-changed` + `behavior-changing` | 新版本改变了执行 | 评估重跑成本后只补跑受影响位置 |
| `identity-domain-unregistered` | 旧结果的 domain 不在当前包的 registry 中 | NiceEval 缺陷，先报告，不要直接重跑 |
| `identity-manifest-missing` | 旧结果写入时还没有保存 identity manifest，只能比较模型、flags 与源码 | 输入未变的结果仍按 digest 正常沿用；digest 不同的按列出的差异决定是否重跑 |
| `unversioned-identity-change` | NiceEval 改了身份计算却没有更换版本 | NiceEval 缺陷，先报告，不要直接重跑 |

后两种不是用户输入变化。重跑虽然能得到当前身份的新结果，但掩盖了上游缺陷，也会让下一次升级重复同一笔花费。

只想查看历史分数时，`show --run <旧 Run ID>` 仍显示当时的结果，不受升级影响。
