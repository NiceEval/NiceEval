# 验收题库

题库不是按模块罗列测试，而是让一个用户可见行为守护一族历史缺陷。
每题必须通过[最终综合的准入门槛](synthesis.md#候选-proof-的准入门槛)，并在实现时保留对应旧 bug 的
fix parent 或最小逆补丁验证登记。

## 用户侧题库

### A1 · 真实进程交付完整且 outcome 自洽

- **守护**：`show --json` pipe 截断 `d8d5a84b`；retry 最终全绿仍 exit 1 `6307c501`；quiet 吞坏结果 `49271b52`；fatal 冒充中断 `b24b22d2`。
- **fixture**：一个输出超过 128 KiB 的本地结果；一个确定性 first-fail-then-pass Eval；一个 deliberate failed / errored 与一个 bystander experiment。
- **动作**：真实 pipe 运行 `show --json`；分别以普通、`--quiet` 和 fatal 场景运行 `exp --json`。
- **公开 oracle**：JSON 可 parse 且 locator 集合完整；最终 eval 全绿时 exit 0；坏结果非零且在承诺的流可见；fatal 不产生 signal 130，不中断 bystander。
- **区分性**：同时比较 exit、signal、stdout、stderr、attempt 原始计数与 eval 折叠结果；任何单一字段正确都不能蒙混。
- **最早失败**：invoke（无法启动）、observe（截断 / 静默）、outcome（退出分类错误）。
- **成本**：每 PR，本地确定性，无模型 / 网络。

### A2 · 发布包消费方矩阵

- **守护**：CJS `init` 后 `list` 崩 `b44420d3`；foreign cwd TSX Report 缺 JSX runtime `d8d5a84b`；docs `runs` / `--reuse-sandbox` 漂移 `8068d6d6`；无 `dockerode` / `e2b` 的冷路径静态 import 崩溃 `0193b29f`。
- **fixture**：由 world prepare 生成 CommonJS、foreign-report、runnable-doc-example 与 minimal-no-optional-peers 四个 consumer dir，全部安装同一候选 tarball。
- **动作**：每个目录只运行文档已经给用户的命令；Report 文件、Eval 与示例正文不为验收加观察点。
- **公开 oracle**：命令退出、公开 experiment / attempt identities、Report 表 / locator 可读；最小消费者在没有 optional peer 时能运行不需要 sandbox 的 CLI。
- **区分性**：仓库根 ESM smoke 不能代替 CJS；Report 自身 cwd 不能代替 foreign cwd；Markdown build 不能代替命令执行。
- **最早失败**：compile / invoke；消息列 consumer kind、cwd、候选包 digest、命令和 stderr。
- **成本**：每 PR，无外部服务。

### A3 · 多步历史与公开 identity 往返

- **守护**：部分 run 遮蔽 carry `85cafd7d`；history locator 自己打不开 `578597b6`；`Sample.scope` 误带同族变体和 Report host 模块身份失联 `1d2fb08e`。batch accept 丢 `selectedEvalIds` `90305b2a`；run / carried 的 `configHash` 与 Judge 读取链分叉 `57d0f153`、`775816b3`、`7812fd41`。
- **fixture**：一个私有 clone，含同族 experiment id、两个历史 snapshot 和一个绝对路径 Report。
- **动作**：full → partial → batch accept → full；从 `show --history` 读 locator，再原样交给 `show @locator --execution` 和 view。
- **公开 oracle**：最后一步只启动真正缺失的 eval；batch view 保留完整 selected eval 集合；run 级 `configHash` 不因单 eval Judge 分叉，carried 选择与 accept 重算使用同一 Judge 链。历史 locator 打开的 attempt identity 完全相同；精确 selector 不多带变体。
- **区分性**：同时断 started / reused 精确集合与 producer → consumer locator 往返，不只断每一步各自 exit 0。
- **最早失败**：invoke / outcome；失败消息附 action 轨迹、候选全集、实际命中和 locator。
- **成本**：每 PR，本地 deterministic adapter。

### A3b · Show 证据切片从安装包完整往返

- **守护**：提交边界遗漏或打包入口漂移导致 `niceeval show`、`--source`、`--execution`、`--timing`、`--timing=full`、`--diff` 中部分能力没有进入最终候选包；flag 尚在但宿主参数或 evidence component 断线的同形回归。
- **fixture**：一份冻结的确定性 Record；同一 locator 同时有具名 source 路径、工具执行节点、runner + OTel timing 层级和单文件 diff，另带零净改动反例。
- **动作**：从公开 locator 依次运行不带证据选项的详情与五种真实 CLI 调试命令；全部经候选 tarball 安装入口，不 import 内部 Show 函数。
- **公开 oracle**：每条命令 exit 0；默认详情列出四类入口；source、execution、timing summary/full、diff 各返回题面声明的领域身份，summary 是 full 的有序子集。
- **区分性**：删 CLI option 与断开宿主参数是两条必杀 mutation；只测 help、下钻提示、内部函数或源码工作树都不能通过。
- **最早失败**：invoke（未知 flag / 包入口缺失）、observe（输出无法读取 / 切片缺失）、outcome（领域事实或 summary/full 关系错误）；附命令、locator、exit、stderr、候选包 digest 与 evidence 路径。
- **成本**：每 PR和发布 tag，本地确定性，无模型 / 网络；完整设计见 [`reports.evidence-slices-roundtrip`](../../e2e/use-case/evidence-slices-roundtrip.md)。

### A4 · 调度与就绪只比较区间关系

- **守护**：一个串行实验钳住全批 `03de80d8`；retry backoff 解除并发限制 `9d7b352`；共享构建全局 barrier `b24b22d2`。
- **fixture**：两个 experiment、每个两个 attempt；一个 attempt 稳定进入一次 retry；两个 BuildKey，其中一个被可控 barrier 延迟。
- **动作**：单次 `exp --json`，从 NDJSON 建 attempt / activity interval。
- **公开 oracle**：同实验最大 overlap 符合各自 `maxConcurrency`；不同实验存在允许的 overlap；retry attempt 从 start 到 final complete 一直占用并发名额；不依赖慢 BuildKey 的 attempt 可先开始。
- **区分性**：只比较事件偏序和集合，不比较“少于 300ms”之类墙钟阈值。
- **最早失败**：outcome；消息列违例的两个 interval、所属 experiment / BuildKey 与原事件行。
- **成本**：每 PR，无 sleep、无 Docker build；真实 Docker 只作较低频 smoke。

### A5 · adapter 身份必须真实读回

- **守护**：Codex / Claude canonical tool name `060a6a05`、`d8d5a84b`；marketplace 名 `5e7549eb`；Codex `plugin list` 形状与 `brief(undefined)` `07416e68`。
- **fixture**：一个无付费协议 fixture 验 canonical tool；一个 pinned 真实 native-plugin consumer world 验安装。
- **动作**：运行原 Eval；负例配置错误 marketplace 名，正例配置 manifest 真名与 pinned ref。
- **公开 oracle**：原 `calledTool("shell")` gate 通过；错误名在 install 前期同时报告 expected / actual；正例的原 `resolvedVersion` gate 通过且缺值时预览不崩。
- **区分性**：exit 0 不能单独通过；必须读事件 canonical identity 或安装后公开结果。
- **最早失败**：invoke / outcome；消息列 adapter、raw identity、canonical identity、plugin id、ref 和 locator。
- **成本**：协议 fixture 每 PR；真实 CLI / pinned repo 定期 lane，隔离 HOME / config。

### A6 · 证据边界保留缺失、空、内容与截断

- **守护**：setup 文件污染 diff `28758142`；零改动误报无证据 `2b81795f`；单 attempt 159 MB `5e7549eb`；机器出口被错误截断 `d8d5a84b`。
- **fixture**：带 Skill 的现有 agent、一个零净改动 attempt、一个超过 artifact 阈值的工具输出和一份大 `show --json`。
- **动作**：读取既有 gate、已规划的 Attempt diff 页面、公开 JSON truncation 标记，并把机器出口接真实 pipe。
- **公开 oracle**：framework setup path 不进 agent diff；artifact 空显示“零改动”而非“无证据”；有损字段明确列 path / 原始与保留字节；无损机器出口完整可 parse。
- **区分性**：三态与两类 payload policy 在同题并列，不能用“文件存在”“stdout 非空”通过。
- **最早失败**：outcome / observe；消息列 artifact path、locator、策略与实际字节数。
- **成本**：小体积代表 E2E 每 PR；registry 全量矩阵走单元。

### A7 · Report 公式与双面语义

- **守护**：visual migration 的 passRate、failure reason、GroupSummary 漂移 `d0b6718` / `f98713ae`；层级 record 特例形态 `f1f4efd6`。24 个 series identity 撞成 6 种 mark `89307454`；compare previous-result / reference parity 与 coverage composition 错位 `7fae6b5e`。
- **fixture**：attempt 数不等且含 partial credit / skipped；同一 result 同时含 error、两个失败 gate 与失败 soft；跨 experiment 同名 eval、null cost 与全 skipped 组；一个含至少 7 个 series 的可视编码代表。
- **动作**：同一结果分别经 non-TTY text 和真实 Chromium web 读取。
- **公开 oracle**：题面独立推导的 `83.3%`、failure reason 优先级、组计票 / cost / 无数据语义；两面逐字段相同；7 个 series 都有可区分的公开视觉身份。
- **区分性**：fixture 让官方公式、attempt 原始比例和 eval 折叠投票给出三个不同答案；原因材料也让四种错误优先级给出不同文本。
- **最早失败**：observe / outcome；消息列领域路径、输入桶、独立推导和两面实际值。
- **成本**：compute contract 每 PR；一个官方 Report 组合 E2E 每 PR，无模型。

### A7b · Drive 调用与行内返回闭合

- **守护**：source 存在时完全跳过 Conversation `5a4d01a9`；events 已在 HTML，却只放 Attempt 末尾，点击 send 行仍只有 status / duration 摘要。
- **fixture**：同一源码文件包含两次 `t.send`，分别产生不同 assistant / tool 内容与工具名；另一个同形 Attempt 不发布 events artifact。
- **动作**：从候选 tarball 导出 Report，在 `clean-url-subpath` 宿主打开 attempt dialog；按 drive API、源码路径与发生序分别展开两次 send。
- **公开 oracle**：每个 send 返回区只显示本轮 assistant / tool 与工具名；已映射轮次不在 Attempt 末尾重复；缺 events 时显示明确 warning。
- **区分性**：恢复 `5a4d01a9^` 与“events 全追加页面末尾”两条 mutation 都必须失败；只测 execution 页面存在、HTML 包含 events、组件 snapshot、target 存在或 dialog 打开不能通过。
- **最早失败**：invoke 对应导出或 target 打不开；observe 对应 drive / return reader 无法寻址；outcome
  对应返回缺失、错挂、重复或缺失状态错误。证据附 locator、drive identity、action 轨迹、artifact 状态、
  target URL、实际 entry kind、HTML evidence 与截图。
- **成本**：每 PR与发布 tag，本地确定性，无模型 / 公网；完整设计见 [`reports.attempt-execution-evidence`](../../e2e/use-case/attempt-execution-evidence.md)。

### A8 · 浏览器 target / enhancement / hosting 闭合

- **守护**：
  - 参数化页改版后链接存在但文档未产出；attempt 专用验收漏掉 experiment / custom page。
  - tooltip selector rot 与退役列表增强 `d489dfd4`；view import 子图热重载 `06588ff8`。
  - clean-url target / artifact 404 `f055aa67`、`f3dcb393`。
- **fixture**：同一份本地确定性 Record 导出站含 attempt、experiment 与自定义参数化 target、稳定 chart point 和 source artifact；另有私有 mutable clone 与长驻 view service。
- **动作**：先对最终 page 清单做 target 输出全集 census；再在 `clean-url-subpath` 分别点击三类代表 target、从 experiment dialog 嵌套下钻 attempt、读 artifact、hover 数据点；最后修改 Report 依赖文件并等待公开 DOM 新状态。
- **公开 oracle**：每个 `{pageId,key}` 都有唯一文档且请求 200；三类 dialog 打开并显示对应身份；嵌套下钻、hash、关闭与焦点状态正确；source 与增强 tooltip 可见；热重载后领域值变化；无浏览器 console / request failure。
- **区分性**：结构 census 防孤儿链接 / 孤儿文档；入口 URL 固定为无尾斜杠且模拟 308；attempt 正常不能替 experiment / custom target 通过；DOM 缺失、文档 404、enhancement 缺失、artifact 404、service 提前退出分别报错。
- **最早失败**：prepare / invoke / observe / outcome；步骤轨迹附 pageId、key、入口 URL、最终请求、HTTP、console/request 日志与截图。
- **成本**：每 PR，真实 CLI、文件、HTTP 与 Chromium；使用 deliberate run，无模型 / 公网 / secret。

### A9 · 进程结束后资源所有权真正闭合

- **守护**：强清时限切断 teardown `5eb19b7b`、`14e5207`；Compose group 逃过 orphan `b24b22d2`；release 后 heartbeat 复活锁 `bd97c9e8`。
- **fixture**：本地可核对资源的长 teardown；Compose 多容器组；同 key 的两个真实 Invocation。
- **动作**：SIGINT 等正常 settle；另一路 SIGKILL 后执行 list → prune → list；锁场景完成第一次后立即第二次 `--rerun all`。
- **公开 oracle**：SIGINT exit 130 且 teardown resource gone；SIGKILL 后 inventory 能列组并在 prune 后为空；第二次 Invocation 无 `lock_wait`。
- **区分性**：进程退出、Pod / container 健康或单次 release 返回都不能单独通过，必须观察外部最终状态和下一次消费者。
- **最早失败**：cleanup / outcome；消息列 signal、resource owner、inventory diff、holder 与 lock 事件。
- **成本**：串行定期 lane；必须注册无条件异常回收，失败后也运行。

### A10 · 官方 sandbox 声明与真实工具面一致

- **守护**：coding-agent 镜像漏非 root `cbac5659`；baseline revision 未传播 `db19c31b`；`/usr/local` 不可写 `8aa93382`；PATH 被误当普通 env 且缺 `pathPrepend` `226303f2`。
- **fixture**：一个官方 Node baseline recipe 与确定性 shell Eval，不安装额外工具。
- **动作**：由公开 sandbox 入口启动一次，读取 user identity，写入 `/usr/local/bin`，通过 `pathPrepend` 暴露临时命令并执行。
- **公开 oracle**：运行用户非 root；写入成功；临时命令只通过声明的 prepend 可见；登记的 execution identity、recipe revision 与实际宿主一致。
- **区分性**：Dockerfile 文本、镜像 build 成功或单独的 unit env 合并都不能通过，必须在真实官方宿主执行三项能力。
- **最早失败**：prepare / invoke / outcome；列 recipe、revision、provider、effective user、PATH 出处与命令结果。
- **成本**：一个官方代表走定期 lane；全 provider / recipe 组合由 U10 结构矩阵负责。

### A11 · Site 文章可发现、可阅读、可沿链接继续

- **守护**：blog index 只展示部分文章、正文 markdown link 不可点击 `acb43e36`。
- **fixture**：本地 production build，至少两篇已登记文章，其中一篇正文含站内 markdown link。
- **动作**：从 blog index 按文章 identity 打开正文，再点击正文链接。
- **公开 oracle**：登记文章全集都可从 index 发现；代表正文渲染为可访问链接并到达声明目标；无 console / request failure。
- **区分性**：直接打开正文不能替代 discover；把 markdown 原文显示成文本不能替代可点击链接；只查组件字符串不能通过。
- **最早失败**：prepare / observe / outcome；列 post id、locale、入口、实际 href、request 与截图。
- **成本**：每 PR，本地 production build 与一个浏览器会话；不逐文章复制交互步骤。

## 单元与结构题

| ID | 题目 | 历史反例 | 通过标准 |
|---|---|---|---|
| U1 | provider SDK 形状 contract | E2B paginator `0cef7946`、`4b37775` | 使用真实 SDK 类型 / fixture；array 假形状不能编译或 unit invoke 立即失败；unknown 不误报 expired |
| U2 | scheduler / lease 可控压力 | retry gate `9d7b352`、heartbeat `bd97c9e8` | barrier 控制在飞写入；release 后旧 generation 永不写回；两类 lease 共享同一组 cases |
| U3 | BuildKey 出处与执行入参矩阵 | platform 两轮修复 `b24b22d2`、`a7584de3` | 每种声明出处只产一个 effective platform，并传入 builder；缺失 / 冲突显式失败 |
| U4 | adapter canonical identity 矩阵 | Codex / Claude tool name、Codex plugin JSON | 每条公开 adapter 入口喂真实协议 fixture；raw 字段不同仍产同一 canonical identity |
| U5 | artifact registry 策略穷举 | 159 MB attempt `5e7549eb` | registry 每项声明 complete / truncated；超阈值保留标记与字节数；commands 等完整字段永不截断 |
| U6 | Report compute 非对称 fixture | `f98713ae` | 三种错误公式数值互异；error / skip / gate / soft 次序互异；renderer 不出现计算分支 |
| U7 | runnable public-example census | `runs` / `--reuse-sandbox` `8068d6d6` | 每个公开 key / flag 映射到至少一个真实 consumer case；文档删除能力时同步删除 case |
| U8 | world / observer 自测 | evidence 污染 `9cbd4f90`、pipe 假观察 | read-only 越权必红；malformed 输出显式 observe error；producer / verifier digest 分离 |
| U9 | Report target 结构 census | 参数化页改版后链接与导出文档脱节 | 最终 page 清单、`enumerate()` 实例、内部 target 链接与导出文件双向闭合；收窄同源；失败不留半套目录 |
| U10 | 官方 sandbox baseline contract | 非 root、revision、`/usr/local`、`pathPrepend` 四次脱节 | 每个官方 recipe / provider 声明 effective user、tool surface、managed env 与 revision；缺项、冲突和声明 / 执行错配显式失败 |
| U11 | 发布源码文本完整性 | literal U+0000 `f07c6a30` | 扫描受发布源码与生成 TS，拒绝除允许空白外的 literal C0 控制字节；转义序列合法；报告文件与 byte offset |
| U12 | Site content registry 与 renderer | blog 列表漏文章、markdown link 退化为文本 `acb43e36` | post registry 与 index identity 全集相等；locale fallback 与 link node 形状由一个结构矩阵拥有；浏览器只跑一个代表 |

## 机制题

| ID | 当前状态 | 可判定验收标准 |
|---|---|---|
| M1 · provider 故障编排 | `GAP` | 能声明 SDK page / error / ambiguous-create 序列；同一用户命令重复 20 次得到同一公开状态；每次总回收 |
| M2 · Build 执行 attestation | `GAP` | 公开 artifact 同时登记 effective platform 与实际 builder / image platform；故意错配在 observe 阶段失败 |
| M3 · 未知配置键拒绝 | `GAP` | `runs` 等未知顶层键在 config load 阶段非零退出；错误含文件、键名、最近候选；不启动任何 attempt |

## 题库维护规则

- 新历史 bug 先归入已有 A / U / M 题；只有出现第二个无法表达的同形案例，才提议新原语。
- 每题只保留一个最高价值用户 E2E，组合矩阵尽量下沉 unit / structure。
- 已登记的目标 proof 若仍有存在资格，删除时说明由哪个 owner 吸收；历史旧测若没有稳定 Behavior、独有错误算法或临时缺口，可直接写明理由删除，不要求寻找 replacement。
- 外部依赖题必须 pinned、隔离凭据 / HOME、声明频率与异常回收；不可把网络抖动算产品回归。
- 每次契约迁移先更新题面公式 / identity 与迁移说明，再更新实现；单独更新 snapshot 视为未验收。
