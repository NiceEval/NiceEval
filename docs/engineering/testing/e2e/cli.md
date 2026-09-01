# 功能域 · CLI

本域回答一个问题：**`niceeval` 命令在真实运行下的可观察行为——选择、退出码、缓存复用——是否符合 CLI 契约。**
它由 `e2e/cli/` 仓库承担（group `cli`）。

仓库使用真实 Agent 与真实模型——真实优先没有例外。
稳定性来自断言对象：只断言机制事实（哪些 Eval 被选中、进程退了几、attempt 是新跑还是复用），不断言模型输出质量。

## 验收计划

### 选择

#### cli-positive-selection

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [预览并收窄](../../../feature/experiments/use-case/选择评测/预览并收窄.md)

- eval id 位置参数按前缀收窄实际运行的 Eval 集合；experiment 选择器按 CLI 契约命中。
- Setup cache 策略在 Config 与 Experiment 可声明 `use | bypass`；`exp --sandbox-setup-cache`
  接受两个显式值与省略默认，不改变同一 Experiment / Eval 的选择 identity，其它值以用法错误退出。

#### cli-no-eval-feedback

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [预览并收窄](../../../feature/experiments/use-case/选择评测/预览并收窄.md)

- Experiment 命中但 Eval 前缀零命中时按用法错误退出，错误信息给出下一步。

#### cli-no-experiment-feedback

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [预览并收窄](../../../feature/experiments/use-case/选择评测/预览并收窄.md)

- 未命中任何 Experiment 的选择器按用法错误退出，错误信息给出下一步。

#### cli-evaluation-kind-admission

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [拆开混型评测](../../../feature/experiments/use-case/选择评测/拆开混型评测.md)

- 普通 `niceeval exp` 在任何 Agent、Sandbox、fingerprint 或 Record 写入前拒绝同时选中 Pass Eval 与 Score Eval 的 Experiment；错误分别列出两类 Eval ID，并要求按题型拆分或收窄。
- Eval Group 的闭合成员集若同时包含 Pass Eval 与 Score Eval，同一公开 preflight 以 Group ID 和两类成员 ID 拒绝；不能靠 Experiment 或 CLI 只选中其中一类绕过非法 Group 定义。

### 退出码折叠

#### cli-failure-error-results

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [experiments](../../../feature/experiments/README.md)

仓库包含四个 Experiment，验收脚本把预期非零退出转换为仓库级成功：

| Experiment       | 内容                    | 预期                                                            |
| ---------------- | ----------------------- | --------------------------------------------------------------- |
| 正常             | 断言通过的 Eval         | 按 Eval 级折叠后退出 `0`                                        |
| deliberate-fail  | 断言必然不通过的 Eval   | Attempt 的 Verdict 为 `failed`，进程非零退出                          |
| deliberate-error | `sandbox.prepare` 在 Context 建立前确定性失败 | Run 仍完整发布，Attempt 为 `errored`；`attempt.get` 的固定 query 保留 locator、outcome 与 verdict，`attempt.trace` 保留阶段、退出码与诊断摘要，所有输出不含 `[object Object]`，且进程非零退出、与 `failed` 判然有别 |
| deliberate-score | 确定性的 Score Eval       | Human 结束标题为 `SCORED`，`RESULTS` 显示实际 `2 score · 1/1 complete`，不冒充 `passed` |
| judge-precheck-error | 两次 Attempt 创建前 Judge endpoint 预检失败 | NDJSON warning 携带 Experiment、Eval 与 `planned: 2` / `errored: 2`，receipt 正常闭合 |

#### cli-provider-error-feedback

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [experiments](../../../feature/experiments/README.md)

Given 同一次 Human invocation 选中四个 Experiment。两个 custom provider 在 `sandbox.create` 以相同
phase/code、不同长 `message` 失败，分别代表 E2B 与 Vercel 外部边界。另两个 Dockerfile sandbox 在不同 Run
中各自以局部 `n1` 和不同的长 builder stderr 于 Attempt 创建前失败；custom provider 的 `cause` 另含只存在于内部的 secret 哨兵。

When 从安装后的 candidate 运行 `niceeval exp provider-error --rerun all`。

Then：

- 四条安全封口后的 `error:` 都可见，长文本按显示宽度折行并以 head + tail 收口；不同 message 不因 phase/code 或跨 Run 的局部 `n1` 相同而合并；
- 两个唯一 BuildKey 各显示一次 cache query 和失败，每行明确只有一条依赖 Attempt，不把共享构建写成 Sandbox 数；

#### cli-cache-inventory

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/sandbox/cli.md](../../../feature/sandbox/cli.md)
<!-- niceeval.e2e-owner-history/v1 action=set from=docs/feature/experiments/README.md at=7c23d9957a9e3433dc82db65a18099b60823e133 -->

Given Docker 的共享 BuildKit builder 报告总容量和 Provider reclaimable estimate，但没有 NiceEval Domain identity、entry 或 lease。

When 从安装后的 candidate 运行 `niceeval docker cache inventory --json`。

Then 输出把 BuildKit 放进独立的 `providerObservations`，状态为 `unverified`，不产生 `domainId`、`evictable` 或 GcPlan。

#### cli-docker-task-build-cache

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [重依赖烘进镜像](../../../feature/experiments/use-case/生命周期/重依赖烘进镜像.md)

Given 一个 Dockerfile Sandbox 的 BuildKey 未变化，且前一次 Invocation 已把 image 与 manifest 写入受管 registry。

When 从安装后的 candidate 连续两次运行同一 Experiment，并明确要求 rerun Attempt。

Then 第一次只显示一次 `built once`，第二次显示 `build cache hit`，fake Docker 的 build 计数仍为一。
两次等待 build 与 consumer use lease 都不占 Attempt permit；测试不读取 `.niceeval` 私有结果证明缓存命中。
- Human 不出现 cause secret、`n1`、BuildKey、timing node、failureId、`cause:` 或 `fix:`；
- 两条 post-Attempt error 各自有可由 `run.get` 发现、再以 `attempt.trace` 读取诊断 details 的 exact Attempt；pre-Attempt error 的
  Run summary 保留其未启动分母。
- 测试从同一 `publicationCutoff` 以 `attempt.get` 读回 Attempt overview、以 `attempt.trace` 读回诊断 details；Human 输出只承担可行动错误反馈，不承担机器读取接口。

### Sandbox 管理入口

#### cli-sandbox-action-debug

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Experiments · debug](../../../feature/experiments/cli.md#debug)

`niceeval debug <experiment> <eval> --json` 从安装后的公开 CLI 交付统一的 Sandbox action plan。
Experiment、Eval Group、Eval 与 Agent action 保留 owner、occurrence、声明次序和拓扑次序。

计划先满足显式依赖，再从 ready set 选择数值最小的 `changeFrequency`。同频 action 按
Experiment → Eval Group → Eval → Agent 与 owner 内稳定声明次序排列。声明式 action 展开 exact steps、自动与补充 fingerprint、
eligibility、Provider capture capability，并固定显示 `cacheLookup: "not-probed"`。

callback 与 legacy command 是 opaque barrier，后续 action 标记 `opaque-ancestor`。debug 只规划；它不创建 Sandbox、
不探 cache，也不执行作者 action、callback、Agent 或 Eval。

#### cli-sandbox-project-preflight

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [experiments](../../../feature/experiments/README.md)

`niceeval sandbox list` 在语法检查成功后准备当前项目的 `.env` 凭据，因此凭据文件不可读时会在调用
Sandbox Provider 前失败；它不加载或求值 `niceeval.config.*`，空留存表仍输出
`No kept sandboxes.`。这个单边界 owner 使用本机空注册表，不连接 Docker、E2B、Vercel 或其它
Sandbox Provider。Sandbox 只接受自己声明的 option；例如 `sandbox list --json` 在凭据准备和配置
求值之前以 unknown option 拒绝，不继承或静默吞掉其它命令的 `--json`。

### 缓存

1. 首次带 `--rerun all` 执行并保存对照 Run。
2. 同一 Experiment 不带 `--rerun all` 再执行，断言结果由公开读取面显示为 carry/cached，且没有产生新的 Agent 调用。
3. 再次带 `--rerun all` 执行，断言产生真实的新 attempt。

其它所有 E2E 仓库每次验收都带 `--rerun all`，不依赖跨运行缓存——缓存语义只在这里验收一次。

### 反馈输出格式

对人读文本与 `--json` 两种输出形态各跑一次真实进程，在真实 stdout/stderr 上断言[Experiments CLI](../../../feature/experiments/cli.md) 声明的反馈契约。`--json` 每行是一个可 `JSON.parse` 的事件对象，永不出现 ANSI 控制字符，正常事件全部落在 stdout，只有 run 建立前的错误落 stderr。非 TTY 人读文本是零 ANSI 的单一 stdout 追加流。真实 PTY smoke 证明运行期确实选择 dashboard renderer、产生光标控制与框面，并与另外两种形态给出一致的完成态判定和退出码。
TTY 的精确宽度、行高降级、折叠和逐帧顺序由[Runner](../unit/experiments-runner.md)对可控 IO 的纯 renderer 输出证明；E2E 不实现第二个终端模拟器，也不逐秒断言心跳节奏。

公开命令与 flag 的进程级失败面同样在本仓库验收。未采纳的 `watch` 是未知命令，必须在装载项目之前以明确用法错误退出。已删除的 `--output` 与不存在的 `--quiet` 是未知 flag；旧读取 flag `--execution`、`--timing`、`--source` 也必须由当前命令 schema 拒绝。`--dry` 的人读/JSON 两面都不写请求的 JUnit 文件，`--dry --json` 只输出一个计划文档而不是事件流。
flag 组合的完整语义矩阵仍由 unit 的纯 parse 与错误对象证明，本域只保留每类公开进程边界的一条区分力代表。

#### cli-live-pty

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [Experiments CLI · 运行中反馈](../../../feature/experiments/cli.md#运行中反馈)

安装后的 `niceeval exp pty-progress --rerun all` 在真实 PTY 中仍活跃时显示 Runner 在 `send()` 起点投影的
`user: <sentinel>`；Eval 不自行调用 `progress()` 冒充该结果。同一
Invocation 随后以零退出结束。owner 只断言可观察的 live detail、PTY 控制 bytes 与终态，不解释帧布局，也不通过退出后的
scrollback 倒推「运行中」状态。

## 边界

flag 组合、错误文案与选择器的语义广度归[单元测试](../unit/README.md)；本仓库证明的是这些行为在真实模型、真实进程退出码下端到端成立。

固定 query 读面在每个仓库验收链尾以各自真实数据验证；本仓库拥有的是运行侧 CLI 行为——选择、退出码、缓存。
## 安装后 CLI 在真实 TTY 中显示声明式 Sandbox step 的安全具体动作，并隐藏 wrapper、正文、source path 与 env values。 {#cli-sandbox-step-activity}

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [docs/feature/experiments/cli.md](../../../feature/experiments/cli.md)
<!-- niceeval.e2e-owner-history/v1 action=set from=docs/feature/experiments/cli.md#声明式-sandbox-step-activity at=a527c598df69bb8ee80d7fd637256942b9f96ee5 -->

安装后 CLI 在真实 TTY 中显示声明式 Sandbox step 的安全具体动作，并隐藏 wrapper、正文、source path 与 env values。
