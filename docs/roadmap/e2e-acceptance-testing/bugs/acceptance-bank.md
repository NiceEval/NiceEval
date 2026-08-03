# 验收题库

题库不是按模块罗列测试，而是让一个用户可见行为覆盖一族历史缺陷。
每题必须通过[最终综合的准入门槛](synthesis.md#候选-proof-的准入门槛)，并在实现时保留对应旧 bug 的
fix parent 或最小逆补丁验证记录。

## 用户侧九题

### A1 · 真实进程交付完整且 outcome 自洽

- **覆盖**：`show --json` pipe 截断 `d8d5a84b`；retry 最终全绿仍 exit 1 `6307c501`；quiet 吞坏结果 `49271b52`；fatal 冒充中断 `b24b22d2`。
- **fixture**：一个输出超过 128 KiB 的本地结果；一个确定性 first-fail-then-pass Eval；一个 deliberate failed / errored 与一个 bystander experiment。
- **动作**：真实 pipe 运行 `show --json`；分别以普通、`--quiet` 和 fatal 场景运行 `exp --json`。
- **公开 oracle**：JSON 可 parse 且 locator 集合完整；最终 eval 全绿时 exit 0；坏结果非零且在承诺的流可见；fatal 不产生 signal 130，不中断 bystander。
- **区分性**：同时比较 exit、signal、stdout、stderr、attempt 原始计数与 eval 折叠结果；任何单一字段正确都不能蒙混。
- **最早失败**：invoke（无法启动）、observe（截断 / 静默）、outcome（退出分类错误）。
- **成本**：每 PR，本地确定性，无模型 / 网络。

### A2 · 发布包消费方矩阵

- **覆盖**：CJS `init` 后 `list` 崩 `b44420d3`；foreign cwd TSX Report 缺 JSX runtime `d8d5a84b`；docs `runs` / `--reuse-sandbox` 漂移 `8068d6d6`。
- **fixture**：由 world prepare 生成 CommonJS、foreign-report 与 runnable-doc-example 三个 consumer dir，全部安装同一候选 tarball。
- **动作**：每个目录只运行文档已经给用户的命令；Report 文件、Eval 与示例正文不为验收加观察点。
- **公开 oracle**：命令退出、公开 experiment / attempt identities、Report 表 / locator 可读。
- **区分性**：仓库根 ESM smoke 不能代替 CJS；Report 自身 cwd 不能代替 foreign cwd；Markdown build 不能代替命令执行。
- **最早失败**：compile / invoke；消息列 consumer kind、cwd、候选包 digest、命令和 stderr。
- **成本**：每 PR，无外部服务。

### A3 · 多步历史与公开 identity 往返

- **覆盖**：部分 run 遮蔽 carry `85cafd7d`；history locator 自己打不开 `578597b6`；`Sample.scope` 误带同族变体和 Report host 模块身份失联 `1d2fb08e`。
- **fixture**：一个私有 clone，含同族 experiment id、两个历史 snapshot 和一个绝对路径 Report。
- **动作**：full → partial → full；从 `show --history` 读 locator，再原样交给 `show @locator --execution`。
- **公开 oracle**：第三步只启动真正缺失的 eval；历史 locator 打开的 attempt identity 完全相同；精确 selector 不多带变体。
- **区分性**：同时断 started / reused 精确集合与 producer → consumer locator 往返，不只断每一步各自 exit 0。
- **最早失败**：invoke / outcome；失败消息附 action 轨迹、候选全集、实际命中和 locator。
- **成本**：每 PR，本地 deterministic adapter。

### A3b · Show 证据切片从安装包完整往返

- **覆盖**：提交边界遗漏或打包入口漂移导致 `niceeval show`、`--source`、`--execution`、`--timing`、`--timing=full`、`--diff` 中部分能力没有进入最终候选包；flag 尚在但宿主参数或 evidence component 断线的同形回归。
- **fixture**：一份冻结的确定性 Record；同一 locator 同时有具名 source 路径、工具执行节点、runner + OTel timing 层级和单文件 diff，另带零净改动反例。
- **动作**：从公开 locator 依次运行不带证据选项的详情与五种真实 CLI 调试命令；全部经候选 tarball 安装入口，不 import 内部 Show 函数。
- **公开 oracle**：每条命令 exit 0；默认详情列出四类入口；source、execution、timing summary/full、diff 各返回题面声明的领域身份，summary 是 full 的有序子集。
- **区分性**：删 CLI option 与断开宿主参数是两条必杀 mutation；只测 help、下钻提示、内部函数或源码工作树都不能通过。
- **最早失败**：invoke（未知 flag / 包入口缺失）、observe（输出无法解析 / 切片缺失）、outcome（领域事实或 summary/full 关系错误）；附命令、locator、exit、stderr、候选包 digest 与 evidence 路径。
- **成本**：每 PR和发布 tag，本地确定性，无模型 / 网络；完整设计见 [`reports.evidence-slices-roundtrip`](../use-case/evidence-slices-roundtrip.md)。

### A4 · 调度与就绪只比较区间关系

- **覆盖**：一个串行实验钳住全批 `03de80d8`；retry backoff 释放闸 `9d7b352`；共享构建全局 barrier `b24b22d2`。
- **fixture**：两个 experiment、每个两个 attempt；一个 attempt 稳定进入一次 retry；两个 BuildKey，其中一个被可控 barrier 延迟。
- **动作**：单次 `exp --json`，从 NDJSON 建 attempt / activity interval。
- **公开 oracle**：同实验最大 overlap 符合各自 `maxConcurrency`；不同实验存在允许的 overlap；retry attempt 从 start 到 final complete 一直占闸；不依赖慢 BuildKey 的 attempt 可先开始。
- **区分性**：只比较事件偏序和集合，不比较“少于 300ms”之类墙钟阈值。
- **最早失败**：outcome；消息列违例的两个 interval、所属 experiment / BuildKey 与原事件行。
- **成本**：每 PR，无 sleep、无 Docker build；真实 Docker 只作较低频 smoke。

### A5 · adapter 身份必须真实读回

- **覆盖**：Codex / Claude canonical tool name `060a6a05`、`d8d5a84b`；marketplace 名 `5e7549eb`；Codex `plugin list` 形状与 `brief(undefined)` `07416e68`。
- **fixture**：一个无付费协议 fixture 验 canonical tool；一个 pinned 真实 native-plugin consumer world 验安装。
- **动作**：运行原 Eval；负例配置错误 marketplace 名，正例配置 manifest 真名与 pinned ref。
- **公开 oracle**：原 `calledTool("shell")` gate 通过；错误名在 install 前期同时报告 expected / actual；正例的原 `resolvedVersion` gate 通过且缺值时预览不崩。
- **区分性**：exit 0 不能单独通过；必须读事件 canonical identity 或安装后公开结果。
- **最早失败**：invoke / outcome；消息列 adapter、raw identity、canonical identity、plugin id、ref 和 locator。
- **成本**：协议 fixture 每 PR；真实 CLI / pinned repo 定期 lane，隔离 HOME / config。

### A6 · 证据边界保留缺失、空、内容与截断

- **覆盖**：setup 文件污染 diff `28758142`；零改动误报无证据 `2b81795f`；单 attempt 159 MB `5e7549eb`；机器出口被错误截断 `d8d5a84b`。
- **fixture**：带 Skill 的现有 agent、一个零净改动 attempt、一个超过 artifact 阈值的工具输出和一份大 `show --json`。
- **动作**：读取既有 gate、`show --diff`、公开 JSON truncation 标记，并把机器出口接真实 pipe。
- **公开 oracle**：framework setup path 不进 agent diff；artifact 空显示“零改动”而非“无证据”；有损字段明确列 path / 原始与保留字节；无损机器出口完整可 parse。
- **区分性**：三态与两类 payload policy 在同题并列，不能用“文件存在”“stdout 非空”通过。
- **最早失败**：outcome / observe；消息列 artifact path、locator、策略与实际字节数。
- **成本**：小体积代表 E2E 每 PR；registry 全量矩阵走单元。

### A7 · Report 公式与双面语义

- **覆盖**：visual migration 的 passRate、failure reason、GroupSummary 漂移 `d0b6718` / `f98713ae`；层级 record 特例形态 `f1f4efd6`。
- **fixture**：attempt 数不等且含 partial credit / skipped；同一 result 同时含 error、两个失败 gate 与失败 soft；跨 experiment 同名 eval、null cost 与全 skipped 组。
- **动作**：同一结果分别经 non-TTY text 和真实 Chromium web 读取。
- **公开 oracle**：题面独立推导的 `83.3%`、failure reason 优先级、组计票 / cost / 无数据语义；两面逐字段相同。
- **区分性**：fixture 让官方公式、attempt 原始比例和 eval 折叠投票给出三个不同答案；原因材料也让四种错误优先级给出不同文本。
- **最早失败**：observe / outcome；消息列领域路径、输入桶、独立推导和两面实际值。
- **成本**：compute contract 每 PR；一个官方 Report 组合 E2E 每 PR，无模型。

### A8 · 浏览器 target / enhancement / hosting 闭合

- **覆盖**：
  - 参数化页改版后链接存在但文档未产出；attempt 专用验收漏掉 experiment / custom page。
  - tooltip selector rot 与退役列表增强 `d489dfd4`；view import 子图热重载 `06588ff8`。
  - clean-url target / artifact 404 `f055aa67`、`f3dcb393`。
- **fixture**：同一份本地确定性 Record 导出站含 attempt、experiment 与自定义参数化 target、稳定 chart point 和 source artifact；另有私有 mutable clone 与长驻 view service。
- **动作**：先对最终 page 清单做 target 产物全集 census；再在 `clean-url-subpath` 分别点击三类代表 target、从 experiment dialog 嵌套下钻 attempt、读 artifact、hover 数据点；最后修改 Report 依赖文件并等待公开 DOM 新状态。
- **公开 oracle**：每个 `{pageId,key}` 都有唯一文档且请求 200；三类 dialog 打开并显示对应身份；嵌套下钻、hash、关闭与焦点状态正确；source 与增强 tooltip 可见；热重载后领域值变化；无浏览器 console / request failure。
- **区分性**：结构 census 防孤儿链接 / 孤儿文档；入口 URL 固定为无尾斜杠且模拟 308；attempt 正常不能替 experiment / custom target 通过；DOM 缺失、文档 404、enhancement 缺失、artifact 404、service 提前退出分别报错。
- **最早失败**：prepare / invoke / observe / outcome；步骤轨迹附 pageId、key、入口 URL、最终请求、HTTP、console/request 日志与截图。
- **成本**：每 PR，真实 CLI、文件、HTTP 与 Chromium；使用 deliberate run，无模型 / 公网 / secret。

### A9 · 进程结束后资源所有权真正闭合

- **覆盖**：强清窗口切断 teardown `5eb19b7b`、`14e5207`；Compose group 逃过 orphan `b24b22d2`；release 后 heartbeat 复活锁 `bd97c9e8`。
- **fixture**：本地可核对资源的长 teardown；Compose 多容器组；同 key 的两个真实 Invocation。
- **动作**：SIGINT 等正常 settle；另一路 SIGKILL 后执行 list → prune → list；锁场景完成第一次后立即第二次 `--force`。
- **公开 oracle**：SIGINT exit 130 且 teardown resource gone；SIGKILL 后 inventory 能列组并在 prune 后为空；第二次 Invocation 无 `lock_wait`。
- **区分性**：进程退出、Pod / container 健康或单次 release 返回都不能单独通过，必须观察外部最终状态和下一次消费者。
- **最早失败**：cleanup / outcome；消息列 signal、resource owner、inventory diff、holder 与 lock 事件。
- **成本**：串行定期 lane；必须注册无条件异常清理，失败后也运行。

## 单元与结构题

| ID | 题目 | 历史反例 | 通过标准 |
|---|---|---|---|
| U1 | provider SDK 形状 contract | E2B paginator `0cef7946`、`4b37775` | 使用真实 SDK 类型 / fixture；array 假形状不能编译或 unit invoke 立即失败；unknown 不误报 expired |
| U2 | scheduler / lease 可控压力 | retry gate `9d7b352`、heartbeat `bd97c9e8` | barrier 控制在飞写入；release 后旧 generation 永不写回；两类 lease 共享同一组 cases |
| U3 | BuildKey 来源与执行入参矩阵 | platform 两轮修复 `b24b22d2`、`a7584de3` | 每种声明来源只产一个 effective platform，并传入 builder；缺失 / 冲突显式失败 |
| U4 | adapter canonical identity 矩阵 | Codex / Claude tool name、Codex plugin JSON | 每条公开 adapter 入口喂真实协议 fixture；raw 字段不同仍产同一 canonical identity |
| U5 | artifact registry 策略穷举 | 159 MB attempt `5e7549eb` | registry 每项声明 complete / truncated；超阈值保留标记与字节数；commands 等完整字段永不截断 |
| U6 | Report compute 非对称 fixture | `f98713ae` | 三种错误公式数值互异；error / skip / gate / soft 次序互异；renderer 不出现计算分支 |
| U7 | runnable public-example census | `runs` / `--reuse-sandbox` `8068d6d6` | 每个公开 key / flag 映射到至少一个真实 consumer case；文档删除能力时同步删除 case |
| U8 | world / observer 自测 | evidence 污染 `9cbd4f90`、pipe 假观察 | read-only 越权必红；malformed 输出显式 observe error；producer / verifier digest 分离 |
| U9 | Report target 结构 census | 参数化页改版后链接与导出文档脱节 | 最终 page 清单、`enumerate()` 实例、内部 target 链接与导出文件双向闭合；收窄同源；失败不留半套目录 |

## 机制题

| ID | 当前状态 | 可判定验收标准 |
|---|---|---|
| M1 · provider 故障编排 | `GAP` | 能声明 SDK page / error / ambiguous-create 序列；同一用户命令重复 20 次得到同一公开状态；每次总清理 |
| M2 · Build 执行 attestation | `GAP` | 公开 artifact 同时记录 effective platform 与实际 builder / image platform；故意错配在 observe 阶段失败 |
| M3 · 未知配置键拒绝 | `GAP` | `runs` 等未知顶层键在 config load 阶段非零退出；错误含文件、键名、最近候选；不启动任何 attempt |

## 题库维护规则

- 新历史 bug 先归入已有 A / U / M 题；只有出现第二个无法表达的同形案例，才提议新原语。
- 每题只保留一个最高价值用户 E2E，组合矩阵尽量下沉 unit / structure。
- 题目删除必须同时给出：被哪一题覆盖、失败是否更早、定位是否更直接、设施成本是否更低。
- 外部依赖题必须 pinned、隔离凭据 / HOME、声明频率与异常清理；不可把网络抖动算产品回归。
- 每次契约迁移先更新题面公式 / identity 与迁移说明，再更新实现；单独更新 snapshot 视为未验收。
