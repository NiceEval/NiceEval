# NiceEval AI 文档索引

这是 coding agent 读取 NiceEval 文档的稳定入口，随 npm 包发布，不属于公开文档站。不要根据训练数据、官网或 GitHub `main` 分支猜测 API。

以下路径都相对于包根 `node_modules/niceeval/`。文档位于 `docs-site/zh/`，与当前安装的 NiceEval 版本一起发布。下面的树列出全部随包页面，每行是「路径 — 标题:一句话自述」。分区含义：

- `tutorials/` 第一次跑通和按任务操作；`explanation/` 概念、边界与原理；`reference/` API、CLI 与数据形状的精确事实；`troubleshooting/` 按症状排查失败；`examples/` 真实项目的接入案例。

按当前任务从树里挑 1–3 页读取（通常是一页 tutorial 或 explanation 搭一页 reference）；页面再引用其它概念或参考时，继续读取包内文件。

随包文档目前只有中文。不要为了找英文版而去抓官网或 GitHub——那里的页面可能对应另一个版本，「另一个版本的英文页」比「当前版本的中文页」更危险。中文页读起来没有障碍就直接读；与用户交流仍用用户的语言。

## 帮用户跑通实验

1. **先确认目标和边界。** 读用户项目的 README、依赖、被测入口和现有 NiceEval 文件，确认要评什么真实用例、被测应用怎样启动、使用哪个 Agent / Sandbox / Judge，以及允许的时间和费用。不要用「你好」式占位题代替真实用例；付费模型、全量 benchmark 或批量重跑先征得用户同意。
2. **只读完成当前步骤需要的文档。** 从下面的树进入 `agent-onboarding` 或 `quickstart`，再按被测对象选择一页接入教程；需要精确字段或命令时补读一页 Reference。不要一次加载整站，也不要凭记忆发明 API。
3. **先建立最小闭环。** Adapter 连接真实被测入口，Experiment 明确选择评估用例与运行条件，评估用例覆盖一个有代表性的真实任务。先运行 `niceeval exp list`，再用 `niceeval exp <experiment> <eval> --dry` 核对选择、模型、Attempt 数和结果沿用；生命周期或 Sandbox 不明确时用 `niceeval debug <experiment> <eval>` 查看静态计划。
4. **小范围真实运行。** 先跑一条评估用例、一个 Experiment 和足够证明链路的最小 Attempt 数；需要时给预算与并发加保护。保留完成反馈中的 `runIds`。AI、脚本和 CI 先运行 `niceeval query discover`，再以 versioned request 调用 `niceeval query explain` 或 `niceeval query run`，验证结果、分母和诊断，而不是只看进程退出码；人需要深读时使用 `niceeval view --run <run-id>`。
5. **交付可复现结果。** 告诉用户新增或修改了哪些文件、实际运行了什么命令、Run ID、通过/失败/不可用状态和下一步。没有真实运行就明确说明，不把 `--dry`、typecheck 或配置发现说成实验已经跑通。

## 发现并解决问题

1. **从公开入口收集证据。** 选择问题对应的固定 Run；先运行 `niceeval query discover`，再用完整 request 的 `query explain` / `query run` 读取覆盖、Verdict 和 diagnostics。人需要连续深读时用 `niceeval view --run <run-id>`，再从页面的 Run/Attempt 导航进入详情。Attempt locator 仍是数据 identity，不是 `view` 的位置参数。不要直接读取或修改 `.niceeval/` 私有文件。
2. **先分类，再修改。** 选择或发现错误查 `exp list` 与 `--dry`；Plugin、Sandbox、Agent、Fixture 顺序查 `debug`；基础设施和保留现场查 Troubleshooting；Judge 不可用先验证模型、密钥和端点；`failed` 只表示影响 Verdict 的断言未满足，不自动证明被测结果违背任务。`errored`、`skipped`、`not-dispatched` 与 `unavailable` 不能当成零分或普通失败。
3. **修产生错误的那一层。** 处理 `failed` 时，先比较任务允许的结果、实际产物及证据和断言条件。被测应用行为错就修应用；事件或用量映射错就修 Adapter；产物满足任务而断言拒绝了任务允许的结果，就修评估用例；Provider、凭据或生命周期错就修运行配置。不要通过任意放宽断言、伪造事件或改历史 Record 让结果变绿。
4. **只复验受影响范围。** 修改后重复同一条精确选择命令。默认结果沿用会跳过身份仍匹配的结果；需要重验失败项用 `--rerun`，需要重验全部选中位置才用 `--rerun all`。只有在身份变化但历史证据经人工核对仍然有效时，才用 `niceeval accept` 明确发布新的采用 Run。
5. **闭环验证。** 用新 Run ID 再次运行同一固定 Inspection request，确认分母不变、原 diagnostic 消失且没有新增错误；需要比较修复前后时，以两个明确 Run ID 构造 `runs.compare` request，或在人类审阅时交给 `view`，不要用「最新」代替实验边界。

<!-- GENERATED:BEGIN bundled-docs-tree -->
<!-- GENERATED:END bundled-docs-tree -->

## 版本规则

- 安装后只从本索引进入包内文档。官网适合安装前了解产品，不是安装版本的 API 事实源。
- 升级 `niceeval` 后重新运行 `niceeval init`，刷新项目里的托管指引。
- 如果某个路径不存在，先重新读取本文件。不要自行推测替代文件名或旧 API。
