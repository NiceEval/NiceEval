# 历史缺陷研究与证据账本

这里用已经修复的真实缺陷反推验收设计。
每条结论同时核对 memory、fix commit、fix 前代码与当时已有测试；memory 只负责找到案例，不单独充当证据。

研究只接受用户已经拥有的入口和用法。
候选 proof 可以生成隔离消费方或故障环境，但不能要求用户修改 Eval、既有测试或产品代码来暴露内部状态。
无法稳定从公开入口触发的缺陷必须归入单元、结构守护或机制缺口。

最终收敛见[证据驱动综合方案](synthesis.md)与[验收题库](acceptance-bank.md)。

## 当前轮次

第 1 轮覆盖进程读面、消费方执行上下文和 provider SDK 边界，新增三种缺陷形态与两条用户侧原语。

第 2 轮覆盖调度、历史记录与 Report 组合，新增「时序关系」与「公开身份闭包」两种形态。

第 3 轮覆盖构建、adapter 与可变 view：逐 key 放行复用时序关系，adapter 复用公开身份读回，设施顺序问题复用私有 clone；但平台案例新增「声明身份与执行事实脱钩」的机制缺口，view 新增长驻 `service()` 原语。

第 4 轮覆盖失败交付、空导出与 artifact 体积边界：前两组复用真实进程结果和结构读面；artifact 案例新增一个 `truncations()` 领域查询，并确认 registry 驱动的单元 contract case 是主守护。

第 5 轮覆盖异常清理、浏览器增强和公开示例漂移：浏览器与示例复用既有 browser / consumer 原语；清理案例新增 `sandboxInventory()` 读面，未知配置键仍是框架机制缺口。

第 6 轮覆盖锁释放、诊断身份和静态托管路径，全部被 action 序列、NDJSON 具名字段与 hosting / browser 原语吸收，没有新增缺陷形态、测试原语或机制缺口。

第 7 轮覆盖 diff 证据边界、外部安装读回和 Report 计算口径：分别复用公开事实三态、真实 consumer identity 闭包与领域 Cell / 跨表面等价，没有新增缺陷形态、测试原语或机制缺口。

当前稳定计数为 **2 / 2**；已满足进入最终综合的门槛。

| 形态 | 正例与反证 | 最少原语 | 归属 |
|---|---|---|---|
| 进程边界被测试替身抹平 | [`show --json` 管道截断与退出码口径](process-result-observation.md) | 真实子进程 `cli()`、分离的 stdout / stderr / exit、真实 pipe、结构解析 | 用户侧 proof |
| 被加载文件的执行上下文没有进入测试矩阵 | [CJS 宿主与跨 cwd Report](consumer-context-boundary.md) | 隔离 consumer world、真实候选包入口、`cli()`、领域读面 | 用户侧 proof 加结构守护 |
| 第三方 SDK 形状被手写 mock 取代 | [E2B paginator 在两个模块重复发生](provider-sdk-shape.md) | 真实 SDK 类型、provider contract case；故障 E2E 尚缺编排 | 单元 / 结构守护与机制缺口 |
| 生命周期事实单点正确，但区间关系错误 | [实验级并发闸的两个旧 bug](scheduler-timeline.md) | NDJSON attempt 区间与集合关系；不比较毫秒值 | 用户侧 proof 加调度单元 |
| 每次运行各自正确，但跨历史选择错误 | [部分补跑与历史 locator](history-roundtrip.md) | 命名 action 序列、NDJSON 身份、公开 locator 往返 | 用户侧 proof 加选择单元 |
| 基础事实正确，但宿主 / 展示组合重新解释语义 | [Sample.scope 与 Report host](composition-closure.md)、[Report 公式归属](report-formula-ownership.md) | 领域身份精确集合、公开入口往返、领域 Cell 与跨表面等价 | 用户侧 proof 加组合 / 计算单元 |
| 局部资源就绪却被整批 barrier 遮蔽 | [构建逐 key 放行](build-readiness-and-identity.md) | 复用 NDJSON timeline 的跨活动先后关系 | 用户侧 proof 加调度单元 |
| 身份声明与实际执行事实脱钩 | [BuildKey 平台的两轮修复](build-readiness-and-identity.md)、[native plugin 安装后读回](external-install-readback.md) | 声明来源矩阵与执行 / 外部读回同源；Build 执行侧证明尚缺 | 用户侧代表 proof、单元 / 结构守护与机制缺口 |
| 多条 adapter 路径没有归一到同一公开身份 | [Codex 与 Claude SDK 工具名](adapter-event-identity.md) | 复用真实 `cli()`、既有 Eval gate、`executionNodes()` | 用户侧 proof 加 adapter contract case |
| 可变输入与观察没有绑定同一个 world | [view 热重载与共享 evidence 污染](mutable-view-world.md) | 私有 clone、命名 action、长驻 `service()`、浏览器收敛 | 用户侧 proof 与设施结构守护 |
| 失败已发生，但进程分类或输出模式没有交付 | [fatal 冒充中断与 quiet 静默](failure-delivery.md) | 复用真实 exit / signal、分离输出流、判定身份读面 | 用户侧 proof 加失败折叠单元 |
| producer 成功但交付物为空或不可消费 | [空 view 与截断 JSON](empty-success.md) | 复用真实 `cli()`、结构读面构造、最小非空契约 | 用户侧 proof |
| payload 边界策略缺失或用错 | [超大 artifact 与完整机器出口](artifact-boundary.md) | registry 驱动 contract case、`jsonSummary().truncations()` | 单元 / 结构守护加一条用户侧 smoke |
| 进程退出与外部资源责任边界混在一起 | [强清 teardown 与 SIGKILL orphan](cleanup-ownership.md) | `service().signal()`、外部状态、`sandboxInventory()`、命名 action | 用户侧 proof 加清理单元 |
| DOM producer 与增强脚本的接缝静默腐烂 | [图表 tooltip 与退役列表增强](browser-enhancement-closure.md) | 复用真实 browser、领域寻址和用户动作闭环 | 用户侧 browser proof |
| 文档 / example 没有作为真实包消费方执行 | [`runs` 与 `--reuse-sandbox` 漂移](public-contract-drift.md) | 复用 consumer world、候选包、真实 `cli()` 与 NDJSON 身份 | 用户侧 proof 加覆盖结构守护 |
| release 返回后仍有旧异步写入到达 | [case lock 与 gate lease 心跳复活](lock-release-closure.md) | 复用私有 action 序列、两个真实进程与 NDJSON lock 事件 | 用户侧代表 proof 加共享 lease 单元 |
| 内部近似字段被误当公开身份、证据或原因 | [diagnostic code 与 failure phase](diagnostic-identity.md)、[diff 证据三态](diff-evidence-boundary.md) | 复用 NDJSON 具名字段、真实 `show --diff` 与短文本 scrubbed golden | 用户侧 proof 加 feedback / 投影单元 |
| 静态产物没有在真实 URL 基底下闭合 | [无尾斜杠 attempt 与 artifact](hosting-base.md) | 复用 hosting matrix、浏览器领域下钻与网络诊断 | 用户侧 browser proof |

## 证据账本

| Bug / fix commit | 当时已经错误的公开事实 | 现有测试为何仍绿 | 捕获原语 | 最早失败阶段与定位 | 用户改动 | 仍未覆盖 |
|---|---|---|---|---|---|---|
| `show --json` pipe 截断 / `d8d5a84b` | 合法的大 JSON 经普通管道只交付 128 KiB，机器出口不可消费 | `src/show/json.test.ts` 直接调用 `runShow()` 并把字符串收进内存，没有真实子进程、pipe 或退出 flush | `cli(command, { pipe: true })` 加 `jsonSummary(stdout)` | observe；报告 JSON parse 失败、命令原文、字节数与 stdout 证据 | 无 | 需要在试点实现真实 pipe 语义，不能用文件重定向替代 |
| 重试后全绿仍 exit 1 / `6307c501` | eval 级结果全绿，但进程结果仍向 CI 宣告失败 | runner 级测试分别证明 attempt 计数；缺少同一 proof 内的 eval 折叠结果与进程退出码关系 | 同一 `cli()` 结果同时观察 exit 与机器摘要 | outcome；列出 eval 折叠状态、attempt 原始计数与实际 exit | 无 | 需有一个无需付费模型的确定性先失败后通过 fixture |
| CJS 宿主无法加载 `init` 生成的 config / `b44420d3` | `npm init -y` 后 `niceeval init` 成功，下一条 `niceeval list` 立即崩 | 仓库与示例都是 ESM；fix 前没有 CJS consumer，类型检查也不会执行包的 CJS loader | `consumerWorld("commonjs")` 加真实 `cli()` | invoke；指明 consumer 形态、命令、stderr 和候选包身份 | 无 | world recipe 需要把候选 tarball 与 consumer 依赖摘要固化 |
| 跨 cwd 装载 TSX Report 报 `React is not defined` / `d8d5a84b` | 报告能在自身 cwd 装载，却不能由别处用绝对路径装载 | fix 前 `host.test.ts` 只测分流和缺文件，热重载测试使用同根 `.mjs`，没有 foreign cwd TSX | `consumerWorld("foreign-report")`、`cli()`、`reportView()` | invoke；指明宿主 cwd、报告项目、最近 tsconfig 与 stderr | 无 | 需要生成最小结果根，避免把 agent 运行成本混进装载 proof |
| E2B reconcile 把 paginator 当数组 / `0cef7946` | 一次可重试的创建故障变成 `sandboxes is not iterable`，整批重试中止 | retry 测试把 reconcile 当任意回调；没有 `reconcileProvision` 测试，错误签名以 `as unknown as` 绕过类型 | 真实 SDK 类型加 provider contract case | compile 或 unit invoke；直接指向 `Sandbox.list()` 返回形状 | 无 | 用户侧无法确定性制造远端歧义故障；缺 provider 故障编排 |
| detached inspect 再次把同一 paginator 当数组 / `4b37775` | 已留存 E2B sandbox 被检查时可能误报 expired | `keep.test.ts` 的 mock 也返回 `Promise<Array>`，测试与错误实现共享同一个假事实 | 同一 provider contract case；CLI 状态 proof 只验公开状态语义 | compile / unit invoke；状态 proof 在 observe 阶段区分 unknown 与 expired | 无 | 真实凭据或 SDK 故障不能稳定进入普通 PR proof |
| 一个串行实验把整批钳成串行 / `03de80d8` | `Experiment.maxConcurrency` 影响无关实验，组运行吞吐违反公开语义 | fix 前只有全局并发与报告 shape 测试；没有两个实验的区间关系，fix commit 也未加测试 | `ndjsonEvents(stdout).attemptIntervals()` | outcome；列出每个实验最大重叠与缺失的跨实验 overlap | 无 | 需要本地确定性慢任务 fixture，不能依赖墙钟阈值 |
| turn retry 退避释放实验闸 / `9d7b352`，测试 `6953d51` | `maxConcurrency: 1` 的同实验 attempt 同时存活，共享状态被覆盖 | 稳态串行测试不进入 retry backoff；修复与区分力测试分成两个 commit | 同一 attempt interval 关系 | outcome；列出重叠 attempt、start / complete 事件与 retry 事件 | 无 | retry fixture 必须从公开 adapter 产生稳定可重试错误 |
| 部分 run 遮蔽 carry 基线 / `85cafd7d` | 一次局部补跑后，全组续跑错误地重跑历史已完成 eval | `latestPerExperiment` 与 runner 各自测试正确；缺少 full → partial → full 的 action 序列 | world action 序列、NDJSON started / reused 身份 | outcome；列出每一步 action、最终实际启动与携入身份 | 无 | 只修复第二层 carry 根因；局部 run 是否可发布仍是产品契约问题 |
| `show --history` 产出的旧 locator 自己打不开 / `578597b6` | 用户复制公开历史 locator 后得到 scope not-found | record 索引能解析旧 locator；show 又用 current sample 二次过滤，层间关系无人证明 | history 读面产出 locator，再交给真实 `cli()` | invoke / observe；同时指向 producer 行与 consumer 命令 | 无 | 当前 fix 有 in-process 行为测试，仍缺发布包真实 CLI 往返 |
| `Sample.scope` 精确 id 误带同族变体 / `1d2fb08e` | 单实验详情被窄化成三个实验并崩溃 | `matchExperimentSelector` 的精确优先单测已存在；调用方逐 id 重算，破坏全集语义 | consumer world、领域 experiment identities | invoke / outcome；列出 selector、候选全集与实际命中 | 无 | fix commit 未加测试；应补组合单元与真实 Report proof |
| Report host 换模块实例后 locator 索引失联 / `1d2fb08e` | `show @locator --report standard` 报 LocatorNotFound | record 单元证明同一模块实例内索引正确；host 委托到 dist 的另一份 locator 查询实现 | 真实 package entry、公开 locator 往返 | invoke；列出 producer / consumer module identity 与 locator | 无 | world manifest 需要锁 producer symbol closure，避免错误入口制造假红 |
| 共享构建做成全局 barrier / `b24b22d2`，区分力测试 `c0bc7915` | 已 ready 或无构建依赖的 eval 仍等最慢 BuildKey | 协调器只测整批结果；runner 测试把“构建全完再派发”写成正确期望 | NDJSON `run_activity` 与 attempt 的先后关系 | outcome；列活动 id、attempt id、事件行与依赖关系 | 无 | recipe 需提供两个可控 build key，不能用墙钟耗时判定 |
| BuildKey platform 与实际构建脱钩 / `b24b22d2`，声明来源补全 `a7584de3` | 不同实际架构可能共享身份并互认不可比结果 | 首轮测试只覆盖探测回落；service `platform` / `build.platforms` 未进输入矩阵仍全绿 | 声明优先级 contract case、有效平台与构建入参同源 | compile / unit invoke；列 service、声明来源、有效平台和执行入参 | 无 | 公开 provenance 没有实际镜像平台证明；框架机制缺口 |
| Codex SDK stream 丢规范工具名 / `060a6a05` | 命令 exit 0，既有 `calledTool("shell")` 仍失败 | 协议单测只期望 raw `name`，精确验证了错误中间形状 | 真实 SDK consumer、原 Eval gate、`executionNodes()` | outcome / observe；列规范名、原始名、locator 与 gate | 无 | contract case 应覆盖每条公开 adapter 入口 |
| Claude SDK stream 同形遗漏 / `d8d5a84b` | `tool_use` 的厂商名无法稳定映射到跨 adapter 规范身份 | Codex 修复已记录风险，但 Claude 没有规范名 gate；修复也未补协议测试 | 同一 adapter contract case 与用户侧 proof | outcome；同一 Eval 换 world recipe 后仍应看到 `shell` | 无 | 需要一个无付费依赖的 Claude 协议 fixture |
| view import 子图热重载失效 / `06588ff8` | watcher、rebuild、reload 都发生，页面仍显示旧 Report | 只改入口 `.mjs` 并人工调整 mtime；未走依赖、config、真实 server 和浏览器 | 私有 clone、命名 mutation、`service()`、浏览器 DOM 收敛 | invoke / observe / outcome；列服务、action、前后 DOM 与 stderr | 无 | `service()` 尚未试点；clone recipe 需包含 Report 项目可变路径 |
| report E2E 后置写共享 evidence 制造假红 / `9cbd4f90` | 产品没坏，晚运行的只读域却找不到 prepare 时 locator | 共享可写结果根和“写操作排最后”头注无法约束新增模块 | read-only world digest、mutable clone、绑定 action | prepare / cleanup；直接指明越权路径或 world digest 变化 | 无 | 删除顺序约定候选；以权限和 clone 结构替代 |
| `ExperimentFatalError` 冒充 Ctrl+C / `b24b22d2` | 本实验错误正文消失、无关实验被中断、进程退出 130 | attempt 内失败与实验闸测试不经过复用池 acquire；混合 cause 跨层关系未覆盖 | 真进程 exit / NDJSON verdict、diagnostic 与 bystander 身份 | outcome；列 exit、事件类型、两个 experiment 结果与错误正文 | 无 | 需要本地 fake sandbox consumer，不能制造真实远端故障 |
| `--quiet` 吞掉 failed / errored / `49271b52` | stderr 仍有进度，最终坏结果却全程无声 | reporter 单元各自正确；quiet 组合把结果 reporter 全摘掉 | 分离 stdout / stderr、真实 exit、坏结果身份 | observe / outcome；列流归属、eval 身份与 stderr 尾部 | 无 | 当前 fix 只有 reporter 纯函数测试，仍缺真实 CLI mode matrix |
| 零可读结果导出空站 exit 0 / `70df7880` | CI 把空报告当成功产物覆盖线上站点 | 只在 `--report` 时校验零结果；其它选择不匹配测试无法覆盖不带选项的 view | `cli(view --out)` 非零、skipped 原因读面 | invoke / observe；列结果根、skipped run 与原因 | 无 | fix 测试直接调用 loader；仍缺真实 CLI 与目标目录原子性 |
| 超大工具输出让单 attempt 达 159 MB / `5e7549eb` | 正常评分完成后，落盘和发布被重复大值拖垮 | writer roundtrip 只用小值；fix commit 未加超大 events / trace 区分力测试 | registry contract case、公开 JSON 的 `truncations()` | unit write / observe；列 artifact、path、原始与保留字节 | 无 | 需要补 registry 驱动测试；用户 smoke 需低成本超长输出 fixture |
| `show --json` pipe 意外截断 / `d8d5a84b` | 无损机器出口被当成有损 payload，JSON 不可解析 | in-process 输出绕过 pipe；只看文件存在或 stdout 非空会假绿 | 同一边界策略模型下的完整型反证；`jsonSummary()` | observe；解析失败直接指向 pipe 与字节数 | 无 | 已由第 1 轮真实 pipe 方案归属，不再另立 payload matcher |
| 强清固定窗口切断 teardown / `5eb19b7b`，二次修复 `14e5207` | Ctrl+C 后进程退出 130，但实验外部资源仍存活 | 注册表单元看不到真实信号；首轮窗口小于合法 teardown 上限，在飞 promise 又不可见 | `service().signal()`、外部资源最终状态 | cleanup；列 signal、退出、teardown settle 与残留资源 | 无 | 需要本地可核对资源 fixture；不能依赖付费服务 |
| Compose 资源组逃过 orphan / `b24b22d2` | 官方 list / prune 说没有 orphan，容器和网络实际残留 | 旧测试只造单 sandbox；多容器设计评审的警告没有变成资源种类矩阵 | `sandboxInventory()`、SIGKILL action、list → prune → list | observe / cleanup；列 group、容器 / 网络数和状态 | 无 | fix 只有 mock 单元；真实 Docker proof 应串行且总执行异常清理 |
| enhance selector 改名后 tooltip 永不增强 / `d489dfd4` | hover 只见浏览器原生提示，样式化 tooltip 不出现 | renderer 单元有点和 title；脚本选择器空匹配不报错；fix 未加自动测试 | `chartPoint().hover()`、`tooltip()` | observe / outcome；列数据身份、步骤、截图和浏览器错误 | 无 | 需要签入含稳定 series / x 的小图表站点 |
| 列表旧增强整段死亡 / `d489dfd4` | 退役代码从不触发，非法 selector 也长期潜伏 | 无页面命中旧 DOM；扫描 selector 只会鼓励补假元素 | 删除死代码；仍在契约的 Table 行为用现有 browser proof | structure；不存在的能力不造 outcome 断言 | 无 | 明确删除“所有 selector 必须命中”候选 |
| docs-site 仍教 `runs` / `8068d6d6` | 用户声明 3 次却静默只跑 1 次 | docs build 不执行示例；examples 不进 typecheck；运行时不拒绝未知键 | runnable example consumer world、NDJSON attempt identities | compile / outcome；列示例路径、声明与实际 attempts | 无 | `defineExperiment` 未知顶层键仍不拒绝，属框架机制缺口 |
| docs-site 仍教 `--reuse-sandbox` / `8068d6d6` | 复制命令立即报未知 flag，教程还描述不存在的行为 | 链接与 Markdown 构建绿；没有真实 CLI example matrix | 同一 consumer world 与 `cli()` | invoke；未知 flag 直接指向页面和命令 | 无 | fix 仅批量改文档，未增加自动守护 |
| 释放锁后在飞心跳把文件写回复活 / `bd97c9e8` | 前一 Invocation 已结束，后一 Invocation 仍等待不存在的 holder | release 单点测试不覆盖已发起写入；低负载难复现 | 两次真实 action、第二次 `--force`、NDJSON lock_wait 缺席 | outcome；列两次 run、holder 与 lock 事件 | 无 | 概率竞态主守护仍是两类 lease 的共享压力单元 |
| diagnostic key 泄漏成 warning code / `436090c5` 等 | 公开 code 编入每条身份，机器消费方无法稳定分支 | `code?` 可选，漏调用点不触发类型错误；落盘与反馈各自单测仍绿 | NDJSON code、identity、phase 分字段读取 | observe；列原始事件和三个具名字段 | 无 | 调用点 census 归结构守护，不再靠 key 前缀兼容 |
| failure phase 取最后生命周期 / `d3792749` | `eval.run` 错误显示 `assertions.evaluate`；普通 failed 被伪造 phase | lifecycle 与 verdict 测试分离，没有比较 error origin | 同一 NDJSON origin 关系 | outcome；errored 比 origin，failed 断省略 | 无 | 已由 feedback 单元与代表 CLI proof 归属 |
| 无尾斜杠子路径下 attempt 全 404 / `f055aa67` | 点击 locator 只改 hash，dialog 不出现 | 本地 server 永远带斜杠；file URL 永远带文件名 | `hosting: clean-url-subpath`、真实 click / dialog | observe / outcome；列入口、请求 URL、HTTP 与截图 | 无 | unit 只算 base；必须保留浏览器 proof |
| 同形 artifact fetch 404 / `f3dcb393` | 文件已导出，页面却误报 artifact 缺失 | 导出布局与 URL 纯函数分开正确，缺真实托管组合 | 同一 hosting proof 内断 source 内容 | outcome；dialog 可开但 artifact 请求失败 | 无 | 不另立 URL matcher，避免与 attempt 链接重复 |
| `agent.setup` 文件污染 agent diff / `28758142` | Skill / 新建 AGENTS.md 被算成 agent 产出，既有 `notInDiff()` 误红 | fake sandbox 只断写过 `.git/info/exclude` 命令，没有真实 attempt 的最终 diff | 既有 Eval gate、真实 `show --diff` 与 scrubbed golden | outcome / observe；列 gate、locator 与实际路径清单 | 无 | 已有 AGENTS.md 不能整体排除；真实修改必须继续可见 |
| 零改动 diff 被误报无证据 / `2b81795f` | artifact 存在却显示 `diff unavailable` | 投影错误复用了“是否值得推荐”的 `capabilities.diff`；修复测试只走纯 renderer | 同一 `show --diff` 的公开三态短文本 | observe；区分 artifact 缺失与 files 为空 | 无 | 不新增内部 capability 读面 |
| marketplace add 注册名与配置名不一致 / `5e7549eb` | add exit 0 后，plugin install 才以错误名字间接失败 | fake CLI 不解析真实仓库 manifest；memory 记录时尚未修 | 隔离真实 consumer world、真 CLI、add 后 identity readback | invoke；同时列 expected / actual marketplace 名 | 无 | 外部 CLI E2E 需网络 / pinned repo，普通 PR 可降级为定期 lane |
| Codex plugin list JSON 形状猜错 / `07416e68` | 真实安装的 `resolvedVersion` 恒缺失，原 gate 又因 `brief(undefined)` 二次崩溃 | canned response 使用不存在的 `{ plugins }` / `id` 形状，测试与实现共同猜错 | 既有 native-plugin Eval gate、真实 consumer world；parser contract case | outcome；列 plugin identity、pinned version、locator；预览不再崩 | 无 | 真实外部 proof 保留一个代表版本，其余 adapter 走 contract case |
| Report 迁移重算错误通过率 / `d0b6718`，修复 `f98713ae` | 页面正常但把两级聚合 83.3% 显示成 attempt 比例 75% | 渲染 smoke 只证明能显示；没有让三种公式给不同答案的 fixture | 领域 summary metric、精确值、text / web `toEqualObserved()` | observe / outcome；列输入桶、独立推导与两面实际值 | 无 | fixture 必须保持非对称，禁止从候选 compute import oracle |
| Report 迁移破坏 failure reason / 丢组摘要 / `d0b6718`，修复 `f98713ae` | soft 抢占 error、多 gate 丢失；组通过率 / 成本 / 时间完全消失 | 每个新组件独立渲染合理内容，没有旧新行为矩阵 | 既有 table row / cell、summary metric 与跨面等价 | observe；缺字段与错值分开，领域路径直接定位 | 无 | 主守护仍是 compute contract case；E2E 只留一个非对称组合题 |

## 候选删除规则

账本不是方案堆积区。
后续证据若证明两条原语表达同一公开事实，只保留失败更早、定位更直接且设施风险更低的一条。
若一个候选只能通过读取内部字段或按 bug 文案写特例来通过，直接删除并把原因记到「仍未覆盖」。

## 收敛状态

第 6、7 轮连续跨模块抽样均未新增缺陷形态、测试原语或机制缺口。
后续不再用新增 matcher 堆案例；最终综合只从本账本压缩主证明、分层归属、试点顺序与验收题库。
