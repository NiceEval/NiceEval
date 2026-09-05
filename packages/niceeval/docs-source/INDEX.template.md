# NiceEval AI 文档索引

这是 coding agent 读取 NiceEval 文档的稳定入口，随 npm 包发布，不属于公开文档站。不要根据训练数据、官网或 GitHub `main` 分支猜测 API。

以下路径都相对于包根 `node_modules/niceeval/`。文档位于 `docs-site/zh/`，与当前安装的 NiceEval 版本一起发布。下面的树列出全部随包页面，每行是「路径 — 标题:一句话自述」。分区含义：

- `tutorials/` 第一次跑通和按任务操作；`explanation/` 概念、边界与原理；`reference/` API、CLI 与数据形状的精确事实；`troubleshooting/` 按症状排查失败；`examples/` 真实项目的接入案例。

按当前任务从树里挑 1–3 页读取（通常是一页 tutorial 或 explanation 搭一页 reference）；页面再引用其它概念或参考时，继续读取包内文件。

随包文档目前只有中文。不要为了找英文版而去抓官网或 GitHub——那里的页面可能对应另一个版本，「另一个版本的英文页」比「当前版本的中文页」更危险。中文页读起来没有障碍就直接读；与用户交流仍用用户的语言。

## 按任务路由

- **已有项目要运行或复验。** 先读 `docs-site/zh/tutorials/agent-feedback-loop.mdx`，再按任务从索引树补读 Authoring、接入或 Reference 页面。保留用户已经给出的范围、授权和预算；只有缺少会改变被测目标、运行边界、凭证边界或费用的决定时才提问。
- **只读诊断。** 先读 `docs-site/zh/tutorials/agent-feedback-loop.mdx`，再从索引树选择相关 Troubleshooting 或 Reference 页面。只从 `show`、`query` 或 `view` 收集公开证据；不要修改项目、重跑 Experiment、采用结果或写入 `.niceeval/`。
- **编写或修正评估。** 先读 `docs-site/zh/tutorials/authoring.mdx` 和 `docs-site/zh/tutorials/evaluation-kinds.mdx`；要连接被测对象时再读对应接入教程。评估输入必须覆盖真实业务能力，并能区分被测系统是否完成任务。
- **首次接入。** 读 `docs-site/zh/tutorials/agent-onboarding.mdx`，它拥有探索、必要决策、事件映射和生命周期的完整步骤。

## 帮用户跑通实验

1. **先确认目标和边界。** 读用户项目的 README、依赖、被测入口和现有 NiceEval 文件，确认要评什么真实用例、被测应用怎样启动、使用哪个 Agent / Sandbox / Judge，以及允许的时间和费用。尊重已有授权；只有这些决定仍缺失且会影响正确性、范围或费用时才问。不要用「你好」式占位题代替真实用例；付费模型、全量 benchmark 或批量重跑先征得用户同意。
2. **只读完成当前步骤需要的文档。** 按上方路由和下面的树选择页面；需要精确字段或命令时补读一页 Reference。不要一次加载整站，也不要凭记忆发明 API。
3. **先建立最小闭环。** Adapter 连接真实被测入口，Experiment 明确选择评估用例与运行条件，评估用例覆盖目标产品有区分度的核心任务，不能退化成普通聊天或算术。写代码前确认四条链都能闭合：协议链从 Experiment 到目标响应，核心能力链从真实输入到业务断言，配置链从声明值到 runtime 消费方，生命周期链从启动、进程级凭证和 readiness 到失败清理。先运行 `niceeval exp list`，再用 `niceeval exp <experiment> <eval> --dry` 核对选择、模型、Attempt 数和结果沿用；生命周期或 Sandbox 不明确时用 `niceeval debug <experiment> <eval>` 查看静态计划。
4. **小范围真实运行。** 先跑一条评估用例、一个 Experiment 和足够证明链路的最小 Attempt 数；需要时给预算与并发加保护。保留最后 receipt 的 `createdRunIds` 和 opaque `publicationCutoff`，并查看 `completion`。`createdRunIds` 只列出已创建的 Run；receipt 只交接这次调用，不能单独证明用户任务完成。先用 `niceeval show --run <run-id>` 在终端快速审阅；需要稳定 JSON 时，运行 `niceeval query discover`，再以 versioned request 调用 `niceeval query explain` 或 `niceeval query run`。需要浏览器连续深读时使用 `niceeval view --run <run-id>`。不要只看进程退出码。
5. **交付可复现结果。** 在已获授权和预算内，主动修复执行链的错误并复验受影响范围。合法业务失败要保留并如实报告，不要为全绿改写应用或断言。缺少真实外部条件时，说清缺的是端口、凭证、数据库或模型服务等，并报告阻塞。告诉用户新增或修改了哪些文件、实际运行了什么命令、Run ID、通过/失败/不可用状态和下一步。没有真实运行就明确说明，不把 `--dry`、typecheck 或配置发现说成实验已经跑通。

## 发现并解决问题

1. **从公开入口收集证据。** 选择问题对应的固定 Run；先用 `niceeval show --run <run-id>` 快速找到异常 Attempt，再用 `niceeval show @<locator>` 查看概览，并按提示进入 `--source`、`--execution`、`--timing`、`--usage` 或 `--diff`。需要稳定 JSON 时运行 `niceeval query discover`，再用完整 request 的 `query explain` / `query run` 读取覆盖、Verdict 和 diagnostics。需要浏览器连续深读时用 `niceeval view --run <run-id>`，再从页面导航进入详情。Attempt locator 仍是数据 identity，不是 `view` 的位置参数。不要直接读取或修改 `.niceeval/` 私有文件。
2. **先分类，再修改。** 选择或发现错误查 `exp list` 与 `--dry`；Plugin、Sandbox、Agent、Fixture 顺序查 `debug`；基础设施和保留现场查 Troubleshooting；Judge 不可用先验证模型、密钥和端点；`failed` 只表示影响 Verdict 的断言未满足，不自动证明被测结果违背任务。`errored`、`skipped`、`not-dispatched` 与 `unavailable` 不能当成零分或普通失败。
3. **修产生错误的那一层。** 处理 `failed` 时，先比较任务允许的结果、实际产物及证据和断言条件。被测应用行为错就修应用；事件或用量映射错就修 Adapter；产物满足任务而断言拒绝了任务允许的结果，就修评估用例；Provider、凭据或生命周期错就修运行配置。已有授权和预算内主动修复执行错误并复验；只读请求不修改。不要通过任意放宽断言、伪造事件或改历史 Record 让结果变绿。
4. **只复验受影响范围。** 修改后重复同一条精确选择命令。默认结果沿用会跳过身份仍匹配的结果；需要重验失败项用 `--rerun`，需要重验全部选中位置才用 `--rerun all`。只有在身份变化但历史证据经人工核对仍然有效时，才用 `niceeval accept` 明确发布新的采用 Run。
5. **闭环验证。** 用新 Run ID 再次运行同一固定 Inspection request，确认分母不变、原 diagnostic 消失且没有新增错误；需要比较修复前后时，以两个明确 Run ID 构造 `runs.compare` request，或在人类审阅时交给 `view`，不要用「最新」代替实验边界。

<!-- GENERATED:BEGIN bundled-docs-tree -->
<!-- GENERATED:END bundled-docs-tree -->

## 版本规则

- 安装后只从本索引进入包内文档。官网适合安装前了解产品，不是安装版本的 API 事实源。
- 升级 `niceeval` 后重新运行 `niceeval init`，刷新项目里的托管指引。
- 如果某个路径不存在，先重新读取本文件。不要自行推测替代文件名或旧 API。
