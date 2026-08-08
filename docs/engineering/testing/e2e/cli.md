# 功能域 · CLI

本域回答一个问题：**`niceeval` 命令在真实运行下的可观察行为——选择、退出码、缓存复用——是否符合 CLI 契约。**
它由 `e2e/cli/` 功能 Repo 承担；manifest 的 `areas` 包含 `cli`，并进入无密钥 PR lane。

仓库使用签入的确定性 Agent fixture，避免把 CLI 功能回归与 provider 凭据、网络和模型输出漂移绑定。
真实 SDK / CLI / provider 的兼容性只由对应 Adapter Repo 证明。

## Owner 表

| Owner ID | 用户结果 | 形态 | 文件 | Lane |
| --- | --- | --- | --- | --- |
| [`#cli-positive-selection`](#cli-positive-selection) | Eval 前缀选择精确的 Eval 集合 | 单边界 E2E | `e2e/cli/test/selection.test.ts` | PR |
| [`#cli-no-experiment-feedback`](#cli-no-experiment-feedback) | Experiment 零命中给出用法错误与下一步 | 单边界 E2E | `e2e/cli/test/no-experiment-feedback.test.ts` | PR |
| [`#cli-no-eval-feedback`](#cli-no-eval-feedback) | Eval 前缀零命中给出用法错误与下一步 | 单边界 E2E | `e2e/cli/test/no-eval-feedback.test.ts` | PR |
| [`#cli-failure-error-results`](#cli-failure-error-results) | `failed` 与 `errored` 的退出码、NDJSON 与 JUnit 可区分 | 单边界 E2E | `e2e/cli/test/failure-error-results.test.ts` | PR |

## 验收计划

### cli-positive-selection

- eval id 位置参数按前缀收窄实际运行的 Eval 集合；experiment 选择器按 CLI 契约命中。

### cli-no-experiment-feedback

- 未命中任何 Experiment 的选择器按用法错误退出，错误信息给出下一步。

### cli-no-eval-feedback

- Experiment 命中但 Eval 前缀未命中时，按不同的用法错误退出，错误信息给出下一步。

### cli-failure-error-results

仓库用两个可区分的 Experiment 对照预期非零退出：

| Experiment       | 内容                    | 预期                                                            |
| ---------------- | ----------------------- | --------------------------------------------------------------- |
| deliberate-fail  | 断言必然不通过的 Eval   | attempt verdict `failed`，进程非零退出                          |
| deliberate-error | 必然产生执行错误的 Eval | attempt verdict `errored`，进程非零退出，且与 `failed` 判然有别 |

正常成功态由所有使用确定性 Experiment 的功能 Journey 自然经过；carry 与 history 由 [Runner](runner.md) owner 证明。
CLI 域不为同一结果复制成功 JUnit 或缓存三步测试。

### 反馈输出格式

对人读文本与 `--json` 两种输出形态各跑一次真实进程，并在 stdout/stderr 上断言
[Experiments CLI](../../../feature/experiments/cli.md) 的反馈契约：

- `--json` 每行都是可 `JSON.parse` 的事件对象，不含 ANSI 控制字符；
- 正常事件全部落在 stdout，只有 run 建立前的错误落 stderr；
- 非 TTY 人读文本是零 ANSI 的单一 stdout 追加流；
- 真实 PTY smoke 证明运行期选择 dashboard renderer，并产生光标控制与框面。它的完成态与退出码必须和另外两种形态一致。
TTY 的精确宽度、行高降级、折叠和逐帧顺序不建立长期自动化 owner。
E2E 不实现第二个终端模拟器，也不逐秒断言心跳节奏。
相关变更按[不自动化](../README.md#不自动化)保存本次真实终端观察。

公开命令与 flag 的进程级失败面同样在本仓库验收：

- 未采纳的 `watch` 是未知命令，必须在装载项目之前以明确用法错误退出；
- 已删除的 `--output`、不存在的 `--quiet`、把 `show` 专属 flag 传给 `exp`、非法 `--timing` mode 也必须在运行前失败；
- `--dry` 的人读与 JSON 两面都不写请求的 JUnit 文件；
- `--dry --json` 只输出一个计划文档，不输出事件流。
公开 flag 组合的语义矩阵由本仓库通过安装后的真实进程拥有；同一“非法组合在运行前给出用法错误”风险可用一张
表驱动矩阵表达，不再为 parser 私有分支复制 Unit。只有真实 CLI 无法稳定制造或区分的具名语法 parse 算法，才登记最小 Unit 例外。

## 边界

flag 组合、错误反馈与选择器的公开语义由本仓库从安装后的候选包和真实进程边界证明。
需要保留的语法 parse 例外必须逐项通过 [Unit 存在资格](../unit/README.md#存在资格)，不能以“语义广度”为整类豁免。

`show` 读面按[公开读回](README.md#公开读回)在各 Repo 的真实数据上验收；本仓库拥有的是运行侧 CLI 行为——选择、退出码、缓存。
