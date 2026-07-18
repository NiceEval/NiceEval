# CLI 域

CLI 域回答一个问题：**`niceeval` 命令在真实运行下的可观察行为——选择、退出码、缓存复用——是否符合 CLI 契约。** 它由一个 contract 仓库承担：`cli-contract`（group `contract`）。

仓库使用真实 Agent 与真实模型——真实优先没有例外。稳定性来自断言对象：只断言机制事实（哪些 Eval 被选中、进程退了几、attempt 是新跑还是复用），不断言模型输出质量。

## 验收计划

### 选择

- eval id 位置参数按前缀收窄实际运行的 Eval 集合；experiment 选择器按 CLI 契约命中。
- 未命中任何 Eval / Experiment 的选择器按用法错误退出，错误信息给出下一步。

### 退出码折叠

仓库包含三个 Experiment，验收脚本把预期非零退出转换为仓库级成功：

| Experiment | 内容 | 预期 |
|---|---|---|
| 正常 | 断言通过的 Eval | 按 Eval 级折叠后退出 `0` |
| deliberate-fail | 断言必然不通过的 Eval | attempt verdict `failed`，进程非零退出 |
| deliberate-error | 必然产生执行错误的 Eval | attempt verdict `errored`，进程非零退出，且与 `failed` 判然有别 |

### 缓存

1. 首次带 `--force` 执行并保存基线快照。
2. 同一 Experiment 不带 `--force` 再执行，断言结果由公开读取面显示为 carry/cached，且没有产生新的 Agent 调用。
3. 再次带 `--force` 执行，断言产生真实的新 attempt。

其它所有 E2E 仓库每次验收都带 `--force`，不依赖跨运行缓存——缓存语义只在这里验收一次。

## 边界

flag 组合、错误文案与选择器的语义广度归[单元测试](../unit-tests/README.md)；本仓库证明的是这些行为在真实模型、真实进程退出码下端到端成立。

`show` 读面在每个仓库验收链尾的 [CLI 读回](README.md#43-cli-读回)里于各自的真实数据上验收；本仓库拥有的是运行侧 CLI 行为——选择、退出码、缓存。
