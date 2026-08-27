# Assertions matcher diagnostic 树使已完成 Run 无法发布

## 现象

一次包含约 116 个 shell occurrence 的正常 Attempt 登记三条 `calledTool(or(commandMatch(...), toolMatch(...)))`。Assertion 已得到 matched 结果，Run 却在封口时以 `runner-record-assertions-invalid` 退出。旧 CLI 只显示嵌套 code；进一步复现分别命中单条 diagnostic 的递归 JSON 深度限制和整个 Assertions document 的 4 MiB 限制。

## 根因

collection matcher 为每个候选保留完整组合诊断树。候选数、matcher 分支数和嵌套深度相乘，解释材料随工具调用数线性增长，多个 scope Assertion 又重复保存同一批候选。持久化层直到最终 schema encode 才拒绝，导致已经完成的判定无法发布。

## 修法

- `evaluateToolMatchCollection` 只累计计数、首个 witness、counterexample 与 unavailable，并保留 8 个代表候选；不再持有全部候选结果树。
- runtime capture 对单条 diagnostic 设置深度、节点和 64 KiB 预算，超限写 `diagnostic-truncated`。
- Assertions current entry 只保存一份 criterion/materials/evaluation/decision/policy/contribution；diagnostic 只进入 `explanationRetention`，observed 不复制同一树。
- Assertions producer 在 4 MiB framing 预算前只裁 nondecisive samples 与 root summaries；criterion、materials、evaluation、decision、policy、contribution、matched / mismatched、gate 与 score 不变。
- 超过 32 KiB 的 source / evidence snapshot 自动写入 Assertions 自己的 blob。4 MiB 只约束 JSON framing，不限制 Attachment 可保留的真实材料。
- `runner-record-assertions-invalid` 的兜底错误保留 schema path 或实际字节数，并由 CLI 直接显示带下一步的消息。

## 回归收据

owner 是 `docs/engineering/testing/e2e/eval.md#eval-assertion-scopes`。确定性 Direct Agent 在一个 Turn 产生 10,000 个 filler command 和末尾目标命令，再经公开 `niceeval exp` 发布；公开 readback 核对决定性前缀 receipt 与有界 explanation。

- v2 开工红灯 candidate SHA-256 `5b7bf141495043fa78297834433c31d51e3bc9427b0f704c81228b778b6c4bcc`：`exp` 与 `show` 均成功，最早失败为公开 assertion detail 缺少 typed `source`，artifact `/tmp/niceeval-e2e-artifacts-uL587v`。

- 旧行为 candidate SHA-256 `b50423ef36621fad800ba682165e4b7c03b70909c373c85890f4b0a1aa6df992`：E2E 在 Record 发布阶段退出 1，artifact `/tmp/niceeval-e2e-artifacts-Dy68FD`。
- 修复 candidate SHA-256 `3aa4663b95e41558d351ca6684cd49021554ebf0e31f7b7e6cd25389d7c4988d`：同一 owner 通过 `niceeval exp` 发布、以 `niceeval show <locator> --json` 读回，Attempt passed，artifact `/tmp/niceeval-e2e-artifacts-1Ivo4l`。
- 同一 candidate 的 takeover 在三个隔离副本、同副本连续两次、Eval Repo 默认并行全量与文件标题单跑中全部通过；summary 位于 `/tmp/niceeval-assertion-takeover.Vgy6yQ/receipts/takeover-summary.json`。

这条回归不读取私有 Record 文件，也不直接调用 matcher 或 producer；红绿都来自安装后的候选 CLI。
