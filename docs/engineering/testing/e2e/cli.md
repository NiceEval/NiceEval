# 功能域 · CLI

本域回答一个问题：**`niceeval` 命令在真实运行下的可观察行为——选择、退出码、缓存复用——是否符合 CLI 契约。**
它由 `e2e/cli/` 仓库承担（group `cli`）。

仓库使用真实 Agent 与真实模型——真实优先没有例外。
稳定性来自断言对象：只断言机制事实（哪些 Eval 被选中、进程退了几、attempt 是新跑还是复用），不断言模型输出质量。

## 验收计划

### 选择

#### cli-positive-selection

- eval id 位置参数按前缀收窄实际运行的 Eval 集合；experiment 选择器按 CLI 契约命中。

#### cli-no-eval-feedback

- Experiment 命中但 Eval 前缀零命中时按用法错误退出，错误信息给出下一步。

#### cli-no-experiment-feedback

- 未命中任何 Experiment 的选择器按用法错误退出，错误信息给出下一步。

### 退出码折叠

#### cli-failure-error-results

仓库包含四个 Experiment，验收脚本把预期非零退出转换为仓库级成功：

| Experiment       | 内容                    | 预期                                                            |
| ---------------- | ----------------------- | --------------------------------------------------------------- |
| 正常             | 断言通过的 Eval         | 按 Eval 级折叠后退出 `0`                                        |
| deliberate-fail  | 断言必然不通过的 Eval   | Attempt 的 Verdict 为 `failed`，进程非零退出                          |
| deliberate-error | `sandbox.prepare` 在 Context 建立前确定性失败 | Run 仍完整发布，Attempt 为 `errored`，`show @<locator>` 显示阶段、退出码与摘要，所有输出不含 `[object Object]`，且进程非零退出、与 `failed` 判然有别 |
| deliberate-score | 确定性的 Score Eval       | Human 结束标题为 `SCORED`，`RESULTS` 显示实际 `2 score · 1/1 complete`，不冒充 `passed` |
| judge-precheck-error | 两次 Attempt 创建前 Judge endpoint 预检失败 | NDJSON warning 携带 Experiment、Eval 与 `planned: 2` / `errored: 2`，receipt 正常闭合 |

#### cli-provider-error-feedback

Given 同一次 Human invocation 选中四个 Experiment。两个 custom provider 在 `sandbox.create` 以相同
phase/code、不同长 `message` 失败，分别代表 E2B 与 Vercel 外部边界。另两个 Dockerfile sandbox 在不同 Run
中各自以局部 `n1` 和不同的长 builder stderr 于 Attempt 创建前失败；custom provider 的 `cause` 另含只存在于内部的 secret 哨兵。

When 从安装后的 candidate 运行 `niceeval exp provider-error --rerun all`。

Then：

- 四条安全封口后的 `error:` 都可见，长文本按显示宽度折行并以 head + tail 收口；不同 message 不因 phase/code 或跨 Run 的局部 `n1` 相同而合并；
- Human 不出现 cause secret、`n1`、BuildKey、timing node、failureId、`cause:` 或 `fix:`；
- 两条 post-Attempt error 各自紧跟 `details: niceeval show @<locator>`；pre-Attempt error 在 receipt 后的 `NEXT`
  按 Experiment 紧跟 `details: niceeval show --run <runId>`；
- 测试实际执行四个 details 命令，并分别读回所属错误；两个默认 Run Human 页错误优先且不展示空 KPI、证据、分析或内部 membership 字段；旧 candidate 对上述长期结果为红，新 candidate 为绿。

### 缓存

1. 首次带 `--rerun all` 执行并保存对照 Run。
2. 同一 Experiment 不带 `--rerun all` 再执行，断言结果由公开读取面显示为 carry/cached，且没有产生新的 Agent 调用。
3. 再次带 `--rerun all` 执行，断言产生真实的新 attempt。

其它所有 E2E 仓库每次验收都带 `--rerun all`，不依赖跨运行缓存——缓存语义只在这里验收一次。

### 反馈输出格式

对人读文本与 `--json` 两种输出形态各跑一次真实进程，在真实 stdout/stderr 上断言[Experiments CLI](../../../feature/experiments/cli.md) 声明的反馈契约。`--json` 每行是一个可 `JSON.parse` 的事件对象，永不出现 ANSI 控制字符，正常事件全部落在 stdout，只有 run 建立前的错误落 stderr。非 TTY 人读文本是零 ANSI 的单一 stdout 追加流。真实 PTY smoke 证明运行期确实选择 dashboard renderer、产生光标控制与框面，并与另外两种形态给出一致的完成态判定和退出码。
TTY 的精确宽度、行高降级、折叠和逐帧顺序由[Runner](../unit/experiments-runner.md)对可控 IO 的纯 renderer 输出证明；E2E 不实现第二个终端模拟器，也不逐秒断言心跳节奏。

公开命令与 flag 的进程级失败面同样在本仓库验收。未采纳的 `watch` 是未知命令，必须在装载项目之前以明确用法错误退出。已删除的 `--output`、`--execution`、`--timing`、`--source` 与不存在的 `--quiet` 对任何命令都是未知 flag。`--dry` 的人读/JSON 两面都不写请求的 JUnit 文件，`--dry --json` 只输出一个计划文档而不是事件流。
flag 组合的完整语义矩阵仍由 unit 的纯 parse 与错误对象证明，本域只保留每类公开进程边界的一条区分力代表。

## 边界

flag 组合、错误文案与选择器的语义广度归[单元测试](../unit/README.md)；本仓库证明的是这些行为在真实模型、真实进程退出码下端到端成立。

`show` 读面在每个仓库验收链尾的[CLI 读回](README.md#43-cli-读回)里于各自的真实数据上验收；本仓库拥有的是运行侧 CLI 行为——选择、退出码、缓存。
