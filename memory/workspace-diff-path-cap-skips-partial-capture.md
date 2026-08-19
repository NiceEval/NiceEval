# workspace diff 路径上限抢在 partial collector 前失败

## 现象

一个 send 窗口修改超过 10,000 个路径时，Attempt 可以正常 passed，但 `workspace.diff` 在导出阶段抛出 `workspace-diff-unavailable`。真实安装评估的单窗口约有三万个路径，因此 File Changes 没有机会按自身上限形成 partial 证据。

## 根因

ledger exporter 与 File Changes collector 共用 10,000 这个数字，却承担不同边界。exporter 在枚举候选时先硬失败；下游已有的确定性前缀、`collection-cap-reached/change` 和 omitted count 永远不会运行。

## 修法

- exporter 的扫描安全上限独立为每 send 区间 100,000 个路径与 256 MiB 去重文本，仍保持一条批量命令和一次文件下载。
- File Changes 的持久保留上限维持每窗口及整份 Attachment 10,000 个 changes。
- 10,000 到 100,000 之间的候选完整进入 collector；collector 按 ASCII path 保留安全前缀并记录至少遗漏的数量。
- 超过 100,000 个路径或 256 MiB 去重文本才是导出资源边界失败，并提示作者用 `defineEval({ diff })` 的 include/ignore 缩窄范围。

## 回归收据

owner 是 `docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox`。确定性 Sandbox Agent 在第二个真实 send 区间创建 10,001 个空文件和 68 份各 1,000,000 bytes 的唯一文本。

- 旧候选 SHA-256 `3aa4663b95e41558d351ca6684cd49021554ebf0e31f7b7e6cd25389d7c4988d`：`niceeval exp --json` 包含 `workspace-diff-unavailable`，artifact `/tmp/niceeval-e2e-artifacts-XlnXON`。
- 路径修复后的中间候选 SHA-256 `b09b3b016d81b213244c76d14c2961ad3cf7d40b84bb3eb4ac19fcc549539997`：68,000,000 text bytes 又在旧 64 MiB 导出门产生 unavailable，artifact `/tmp/niceeval-e2e-artifacts-xyFAlB`。
- 完整修复候选 SHA-256 `e1231e0e332a3296d92b7f0c485eb4fdfe5c17d82430e243600f9558c6330a53`：没有 unavailable warning，Attempt passed，公开 `show <locator> --json` 读到 `collection-cap-reached`，artifact `/tmp/niceeval-e2e-artifacts-Yc63uR`。

回归不读取 ledger、Record 文件或私有 collector；红绿均来自安装后的候选 CLI。
