# 写作规则

句子不超过 140 个字符，段落不超过 320 个字符。

“不用的词”只收三类词：已退役的产品名与 API 名、口语和含义模糊的比喻、描述进度而不是目标行为的写法。
环境、记录、解析、覆盖这类常用词不进表：它们本身不含糊，禁用只会逼出更绕的说法；同一句里可能指多种对象时，写清是哪一个。

## 不用的词

| 词 | 改成 | 为什么 | 只在 | 例外 |
| --- | --- | --- | --- | --- |
| \<code\> | Markdown 行内代码使用反引号；路径中的尖括号直接写在反引号内 | HTML code tag 让简单标识多一层转义，并与仓库已经采用的 Markdown 行内代码写法混用 |  |  |
| Run Slot | Slot / 执行槽位 | Slot 已经由所属 Run 定位；组合写法会让读者误以为还有另一种未定义的槽位 | docs |  |
| FactRequirement | 具名 Record family contract 与固定 Inspection operation request | Record 不提供通用 Fact 查询；持久 family 与固定读取操作由各自 owner 定义 |  |  |
| Record SDK | 按语境写 Record Host、owner-scoped writer、bounded reader 或 maintenance | 同一个宽泛名称会把 ordinary reader、迁移能力与 owner-local collector 误解成万能 client | docs |  |
| Record value | 写完整 Record，或 NiceEval internal validated Attachment snapshot | 完整已发布事实集与 owner-local internal snapshot 的能力边界不同 | docs |  |
| inspectFact | 九个固定 Inspection operation 中对应的具名操作 | 读取必须绑定明确 selection 与固定 operation，不能开放为任意事实查询 |  |  |
| defineJsonFact | 使用 Record.attempt()、Record.run() 或 Record.attemptCollection() 声明具名 family | 持久定义必须表达 owner、family、Schema、validation 与 closure，不能退化成无类型 JSON |  |  |
| ctx.fact | 使用 producer-owned fixed collector input | 运行时持久化必须经过 owner 与静态 definition，不能由通用上下文写入无类型 JSON |  |  |
| RecordChannel | fixed Attachment family | 落盘数据不是 FIFO、Stream 或通信通道；Attachment definition 直接表达它附着于 Run 或 Attempt |  |  |
| ChannelProjectorId | property token id、TS field、durable family 或 Inspection operation id——按实际角色写 | 内部定义身份、内存字段、持久 family 与固定操作身份彼此独立，不能合成一个通用 ID |  |  |
| ChannelDescriptorSchemaId | Attachment persistence 的 stable family 与 numeric revision | family identity 与版本分开，不能再造 descriptor schema 代际 |  |  |
| descriptorSchemaId | Attachment persistence 的 family 与 numeric revision；collection 留在 logical value | 动态 descriptor table 会把一个 owner-local Attachment 拆成多余版本层 |  |  |
| ProjectionRead | 具名 Record family read 或固定 Inspection operation result | 一个名字不能同时表达内部 Attachment read 与公开的固定操作结果 |  |  |
| ReportPlan | 固定 View revision build；不提供作者页面计划 | View 由第一方实现决定，不存在需要用户编排的页面或渲染计划 |  |  |
| ReportInput | 固定 Inspection request 或经过完整验证的 canonical Record | 宽泛输入容器会重新引入任意查询、作者依赖闭包与自定义呈现能力 |  |  |
| ProjectionMatrix | runs.compare result | 比较结果由固定 operation 定义，不是可编排的二维投影模型 |  |  |
| execution projector | reuse planning / ExecutionReusePlan | 该过程规划 reuse 与 gap，不与 RecordAttachment projector 共享同一语义 |  |  |
| producer profile | 具名领域 fact definition，例如 AssertionsAttachment | profile 没有说明它验证哪一组持久事实 |  |  |
| owner temp | incomplete Run directory 或 scoped temporary directory | 写出实际生命周期与删除条件，不使用未定义的临时术语 |  |  |
| 无 writer-lock | reader 不取得 writer lock，但取得 shared maintenance lock | Record migration 需要跨 major 的 exclusive maintenance window，因此 reader 并非无锁 |  |  |
| ↩ | 时效靠三条通道:相对时距(\`formatTimeDistance\` 的 \`12d\`)、web 面降饱和与 hover 说明 | 装饰符号不携带时长,读者要先学会它才知道这一行旧了多久;而且它与 ✓ ✗ ! 这套判定符挤在同一格,看起来像又一个判定符 |  |  |
| s1/t1 | 主会话写 turn1；其他会话写 session2/turn1 | s/t 缩写不自描述，而且主会话的 s1/ 是恒定噪音；轮标签统一使用已裁决的自描述词 |  |  |
| 钩子 | 生命周期 / 生命周期 Hook | 同一机制两个名字,读者要先猜是不是两回事;Hook 已是 concepts.md 总表的首选写法 |  |  |
| 判决 | 判定 / Verdict | Verdict 是四态评分结论;「判决」带终局意味,会和 errored 这类执行结论混成一层 |  |  |
| scoring | 按语境写题型、判分阶段或判定;代码字段、命名空间与阶段标识写进反引号 | 正文裸词同时被用来指 pass/points 题型、断言求值与 Verdict 折叠,读者无法判断说的是数据分类、生命周期还是最终判定 |  |  |
| 黑盒 | 无侵入 / Tier 1、Tier 2 | Tier 1、Tier 2 拿得到完整事件流甚至 OTel span,不是看不见内部;「黑盒」把观测质量说反了 |  |  |
| 早停 | 首过即停 / earlyExit | 「早停」在机器学习里指按指标提前终止训练,不是「先过一次就中止其余 attempt」 |  |  |
| 工件 | artifact | 落盘产物的首选写法是英文原词;「工件」在中文里是机械加工的零件 |  |  |
| 严重级 | 严重度 / Severity | 总表首选写法是严重度,同一概念不留第二种译法,否则全文搜索漏一半 |  |  |
| 值级断言 | 值断言 | 断言分类的名字要与 docs/feature/assertions/ 逐字一致,多一个词读者会去找不存在的类别 |  |  |
| 夹具 | Fixture | Fixture 在 niceeval 里是写进沙箱的起始文件,不是 xUnit 那种测试装置 |  |  |
| 评判模型 | 裁判模型 / Judge | Judge 的中文解释只保留一种写法,便于跨文档搜索 |  |  |
| 榜单 | 默认报告、实验行、读数表、成绩单(Scoreboard)、排行图——写那个具体的东西 | 「榜单」是页面语境里的别名,会随版面变化,而且同一个词在不同段落分别指默认报告、实体数据源和图表三样东西;数据源、原语与区块中文名描述的是稳定角色 |  |  |
| 排行榜 | 排行图或对应区块的稳定中文名 | 与「榜单」同一类别名,读者在 API 面里找不到这个词;图表形态由 Chart series 的 mark 表达 |  |  |
| 条形图 | 柱状图(Chart 的 bar mark) | 同一种 mark 两种译法,搜索会漏一半;柱状图是仓库统一写法(横向摆放时正文写「横向柱状图」) |  |  |
| 工作台 | 对应页名或组件中文名 | 内部代号不是契约,读者在 API 面里找不到这个词 |  |  |
| 当前数据集 | 按语境写 sealed cutoff、operation selection 或可编辑的外部输入 | Record 保存已经发生的事实；固定 Inspection 显式说明读取范围，不建立漂移的“当前数据集” |  |  |
| 选集 | 按语境写 operation selection、runIds、Attempt locator 或 sealed cutoff | 固定 Inspection 直接说明选择身份与范围，不建立通用中间选择对象 |  | 候选集、自选集 |
| dual-face | 分别写机器读的 `show --json` 与人读的 View | 两者只共享 sealed facts，不共享 renderer、步骤或同一报告模型 |  |  |
| probe | 按实际动作写探测、检查命令或探测命令;代码字段、函数与标识符写进反引号 | 裸用英文既没有说明检查的对象,也把可读的中文术语和 API 标识符混在一起;正文应说明它探测什么或使用稳定中文名 |  | e2e-browser-scenario-probe-loop-brittleness |
| resolve | 写具体动作:解析配置、按键查表、求值、选择实现或规范化数据;代码标识符写进反引号 | 单词本身没有说明输入经历了哪一步;正文非必要不用,代码标识符引用不受影响 |  |  |
| Resolved | 写结果的具体名字:解析后的配置、已求值的 page——说清被做了什么 | 同 Resolve:形容词词形照样太通用,「Resolved X」没说 X 经历了哪一步 |  |  |
| Resolver | 按职责起名:解析什么就叫什么的解析器 | 同 Resolve:施动者词形,一个 Resolver 可以指任何东西 |  |  |
| helper | 写具体职责:解析器、构造器、命令执行器、查找函数、Fixture 工厂或清理函数;既有代码标识符写进反引号 | helper 只说某段代码提供帮助，没有说明它处理什么输入、产出什么结果或拥有哪条边界 |  |  |
| helpers | 逐项写出这些代码的具体职责;既有目录名或代码标识符写进反引号 | 复数形式仍是没有职责信息的口袋分类，容易把 parser、runner、Fixture 与 cleanup 混进同一层 |  |  |
| 台账 | 按对象写成清单、索引、发布记录、重试记录或问题记录 | 会计比喻掩盖了数据结构与所有权；同一个词在正文里分别指发布事实、重试证据、memory 索引和问题记录 |  |  |
| 棘轮 | 直接写约束，例如数字只能减小、不能增大 | 机械比喻要求读者先理解 ratchet 才能知道约束；规则真正需要表达的是具体的变化方向 |  |  |
| 闸 | 按机制写并发限制、停止派发、失败熔断、准入条件或对应的具体状态 | 同一个水闸比喻被用来指并发占位、调度停止与错误熔断，隐藏了触发条件、作用范围和解除方式 |  |  |
| t.sandbox.diff | 归因期望用 \`changedPaths\` / \`noChanges\` / \`fileChanged\` / \`fileDeleted\` / \`notInDiff\` 声明；文件当前内容用 \`readText\` 读取 | 已定的 Assert-first author API 不存在通用或延迟的 diff subject；持久 \`niceeval.diff/v1\` 只经固定 Inspection operation 读取 |  |  |
| sandbox case | 正文按事实写 Sandbox 实例，或主 Sandbox 实例及伴随资源；既有 API 标识符放进反引号 | case 是项目自造的壳词，既看不出主 Sandbox、伴随资源与生命周期边界，又容易和测试 case 混淆 |  |  |
| 运行单元 | 按实际对象写实例、进程、任务、调度项、读模型或主 Sandbox 实例及伴随资源 | 这个抽象名没有说明什么在运行、由谁拥有或按什么边界创建和销毁 |  |  |
| 资源组 | 逐项写主 Sandbox 实例、sidecar、网络、volume、服务句柄或 Provider 资源 | 组字掩盖了实际成员和生命周期；单 Sandbox、Compose 与云 Provider 所谓的组并不是同一种对象 |  |  |
| 已实现 | 删掉——契约不描述代码进度 | docs/ 写目标状态;进度由文档在 feature/ 还是 roadmap/ 表达 |  |  |
| 未实现 | 删掉,或把这篇设计整体放进 docs/roadmap/ | 写进正文的「未实现」几周后就是错的,而且没人回来删 |  |  |
| 审查状态 | 删掉;审查过程与结论留在对话、commit 或 memory/，正文只写裁决后的目标契约 | Feature 与 Roadmap 都是最终状态说明;审查人、日期和通过与否属于文档形成过程，不是产品契约 |  |  |
| 评审状态 | 删掉;把已经裁决的产品形状直接写进正文 | 评审是否完成会随协作进度变化，不能成为目标契约的一部分 |  |  |
| 验收记录 | 最终契约留在 docs/，历史验收证据与草稿问题移入 memory/ | 验收记录描述谁在何时检查了什么，是形成契约的过程材料 |  |  |
| 实现进度 | 删掉;是否落地只由 feature/ 与 roadmap/ 的目录归属表达 | 实现进度会随代码变化而过期，正文只声明最终行为 |  |  |
| 已经实现 | 直接声明产品行为;要引用这种进度写法本身时放进反引号 | 与「已实现」同义，只是插入副词后绕过了原有守护 |  |  |
| 已改为 | 正面写最终使用的形状 | 差分句要求读者先知道旧形状，目标契约只需要声明最终形状 |  |  |
| 未决问题 | 在 Design 或对话中裁决后再写入 Roadmap / Feature | 未决问题不是最终契约，留在正文会让读者无法据此实现 |  |  |
| 待裁决： | 先完成裁决，正文只保留结论 | 带冒号的待裁决清单是开放问题，不属于最终状态说明 |  |  |
| 尚未定稿的反馈问题 | 把已裁决的反馈形状直接写成契约 | Roadmap 只接收已经定稿的目标，未定稿问题应留在 Design |  |  |
| 实现前仍开放的细节 | 在 Design 中裁决后写成确定的不变量与参数 | 开放实现问题会让 Roadmap 无法作为实现输入 |  |  |
| 定稿后需改写 | 现在就把受影响契约写成最终形状，或只列稳定的相关契约 | 未来改写清单是文档维护任务，不是产品行为 |  |  |
| 采用顺序 | 改写为目标体系的组成与不变量 | 采用或实施先后会随项目进度变化，不能进入最终契约 |  |  |
| 已迁移： | 标题直接写当前用例要证明的用户结果 | 迁移完成与否是文档历史，标题应让新读者直接看到最终主题 |  |  |
| 旧 Use Case | 直接写当前 Use Case 入口 | 用旧入口维持迁移时间线会迫使读者先理解已经淘汰的组织方式 |  |  |
| 目前 | 直接写目标行为 | 「目前」把当前实现当契约,读者分不清哪句是该照着做的 |  | 到目前为止 |
| 现已 | 重写受影响小节 | 差分句要求读者知道旧稿长什么样,新读者读不懂「现已」相对的是什么 |  | 实现已 |
| 不再是 | 正面写现在的形状 | 「不再是 X」只否定旧稿,没说清现在是什么。只禁这个系词形态:「不再执行」「不再派发」描述的是运行时行为,不是相对旧稿的差分 |  |  |
| 不再叫 | 直接写现在的名字 | 改名的旧名字是过程,读者只需要知道现在叫什么;要留改名记录就记进 memory/ |  |  |
| 新版 | 写具体行为,或写清版本号 | 「新版」相对谁不明确,发一次版就过期 |  | 新版本 |
| 之前是 | 只留结论,过程记进 memory/ | 时间线是过程;docs/ 只承载定稿契约 |  |  |
| TODO | 当场裁决,或记成 memory/ 条目 | 正文里的 TODO 既不是契约也没人认领,读者会当成设计缺口 |  |  |
| 温基线 | 复用 Sandbox 的题间重置点(句内回指写「重置点」) | 同一个 commit 有两个名字:总表立的是「复用 Sandbox 的题间重置点」,正文写温基线就等于让读者靠猜把两个词对上。这个概念已经因为换名死过一次——总表曾立「重置基线」而正文一次没用。 |  |  |
| 热道 | Sandbox 复用;需要说明数量时直接写「一个或多个 Sandbox」 | 「热道」是实现比喻,不能直接说明资源是什么、一个 Sandbox 内是否并行或多个 Sandbox 如何组合 |  |  |
| 缺省 | 默认;若要表达字段不存在,写「省略时」「未声明时」或「未提供时」 | 「缺省」同时被用来指默认值与输入缺失,会把两个不同状态写成同一个词 |  |  |
| 兜底 | 写具体机制:默认值、最后一级、失败回退、保底措施或异常清理 | 「兜底」不说明谁在什么条件下采取什么动作,不同段落分别拿它指配置默认、fallback 与清理路径 |  |  |
| 裸 | 写具体形态:不带选项、未包装、原始对象、纯文本或直接调用 | 「裸」依赖上下文猜省略了什么;在 CLI、数据结构与协议段落里分别指完全不同的形态 |  | 裸机 |
| 钉住 | 固定 / 显式指定 / 由……决定 | 「钉住」是内部口语,没有说明值是配置固定、版本锁定还是由上层输入决定 |  |  |
| 钉死 | 固定 / 锁定 / 用算例证明 | 「钉死」把版本约束、配置指定与测试证明混成同一个比喻 |  |  |
| 塞进 | 按实际动作写「写入」「放入」「并入」「作为字段传入」 | 「塞进」省略数据边界和结构关系,读者看不出是在持久化、组装对象还是传参 |  |  |
| 挂了 | 失败 / 报错 / 不可用 / 中止——写实际状态 | 「挂了」无法区分断言失败、进程崩溃、服务不可用与生命周期中止 |  |  |
| 弄挂 | 使其失败 / 构造失败场景 | 「弄挂」是口语,没有交代要触发的具体失败状态 |  |  |
| 砍掉 | 删除 / 排除 / 不纳入设计 | 「砍掉」只表达动作力度,不说明字段是被删除、拒绝采用还是移出当前范围 |  |  |
| 掐短 | 缩短 / 设置更小的上限 | 「掐短」是口语比喻,配置契约应直接写被缩短的值与覆盖关系 |  |  |
| 拍平 | 展平 / 合并成单层结构 | 「拍平」不是稳定的数据变换术语,无法从字面判断层级如何丢失 |  |  |
| 一坨 | 对象 / 字面量 / 未校验的数据——写具体对象 | 贬义修辞没有提供数据的形状或问题,也不适合目标契约 |  |  |
| 核心活 | 核心职责 / 主要工作 | 口语省略了责任边界,架构文档应直接写组件承担的职责 |  |  |
| 真功夫 | 关键职责 / 主要复杂度 / 必须人工定义的语义 | 修辞没有说明难点来自协议映射、语义判断还是实现复杂度 |  |  |
| 死胡同 | 没有后续操作入口 / 无法继续展开 | 比喻没有说明用户缺的是命令、链接还是数据 |  |  |
| 硬扛 | 依赖预览承载完整内容 / 在有限空间内显示完整内容 | 口语没有说明被突破的是行数、字节数还是界面空间预算 |  |  |
| 糖衣 | fatal 错误类(ExperimentFatalError / EvalFatalError)/ 简写 | 口袋比喻:错误类、断言简写、便利构造都能叫它,名字不说明所指;按所指直呼——抛出点的 fatal 错误类,或 t.require 这类简写 |  |  |
| 构造糖 | 便利构造 / 只负责构造数据 | 与「糖衣」同一比喻;要说的是「类只负责携带数据」,直说,比喻不出力 |  |  |
| 条件工具 | 点名具体工具并说它随什么变:随 experiment 变的工具(如记忆助手 mempal) | 「条件」在 niceeval 里没有立过词,读者要猜指实验变体还是判分条件;抽象类名不携带信息,具体例子才携带 |  |  |
| 物化 | 写具体动作与产物:例如「Docker 按 BuildKey 构建 image」「E2B 构建 template」「从 image / template / snapshot 启动 Sandbox」「publish() 解引用并复制 artifact」「把判断写入 coverage 字段」「按内容哈希复制到 assets/」;materializer 这类 API 名照写英文 | 口袋词:构建镜像、启动 Sandbox、复制 artifact、写结果字段与生成静态页面都能叫它,读者拿不到具体动作 |  |  |
| 底座 | 点名具体对象:environment profile、sandbox source、sandbox case、Docker image、E2B template、Vercel snapshot 或主 Sandbox | 同一个词同时指环境声明、可复用构建结果与运行实例,会把构建期和 attempt 启动期混成一步 |  |  |
| 底座产物 | 点名 Provider 原生对象:Docker image、E2B template 或 Vercel snapshot | 把未定义的「底座」与泛称「产物」叠在一起,仍然没有说明要构建、切换或启动的是哪一种对象 |  |  |
| 缓存产物 | 点名缓存内容:例如 Docker image、E2B template、Vercel snapshot 或 staged payload | 没有说明缓存的是 Provider 启动输入还是 Layer 安装文件,两者的身份与失效规则不同 |  |  |
| 制品 | 点名具体文件或对象:例如 npm tarball、Docker image、E2B template、Vercel snapshot、staged payload、Record artifact、\`agent-guide.md\` 或 \`skill.md\` | 同一个词被用来指安装包、Provider 启动输入、Record artifact 与随 npm 包分发的文档,无法判断归属、格式与生命周期 |  |  |
| 扇出 | 写具体传播或生成关系:例如「为每个依赖该 BuildKey 的 attempt 写入同一错误」或「从一组输入生成多条 eval」 | 这个词只表示一变多,没有说明被复制的是任务、错误、数据还是调用 |  |  |
| 自组织 | 写实际优先级,例如「显式配置优先于约定」 | 没有说明由哪些输入、按什么规则得到结果;配置契约需要直接声明优先级 |  |  |
| 摊薄 | 写清成本如何分配,例如「一次 Sandbox 安装由同一实例承接的多个 attempt 共用」 | 比喻没有说明被分配的是时间、费用还是固定开销,也没有说明跨哪些执行单位分配 |  |  |
| 首版 | 直接写稳定目标行为；阶段范围放 roadmap 或 memory | feature 文档是定稿契约,相对某个实现阶段的承诺会过期 |  |  |
| 第一期只有 | 写穷尽的当前契约集合,或把未裁决扩展移到 roadmap | 把临时范围写进目标契约,读者无法判断哪些能力长期存在 |  |  |
| 第一阶段没有 | 直接写设计是否提供该能力 | 阶段措辞给未来兼容留口,却没有定义何时或为什么改变 |  |  |
| stale | 指纹不同的旧结果写 \`previous-result\`；心跳超时的 Session 写「失活 Session」 / \`expired\` | 这个词同时被用来表示旧结果不可比、Session 心跳过期和普通内容陈旧，读者无法从词本身判断对象和下一步 |  |  |
| 水位 | 按对象写 Run、执行批次、当前结果集、发布结果范围、并发数或 input token 数 | 这个比喻同时被用于持久化 Run、operation selection、发布范围、并发上限和上下文用量，无法说明实体、时间范围或选择口径 |  |  |
| materialization | 按实际阶段写创建 Sandbox、构建 Provider 输出、恢复缓存、读取 payload 或生成资源 | 同一个抽象词混指资源创建、缓存生成和延迟读取，读者无法判断发生了哪个动作 |  |  |
| materialize | 按实际动作写 create、build、restore、read、load 或 generate；代码标识符写进反引号 | 动词没有说明生成或读取的对象，也把多个生命周期阶段压成一个含糊步骤 |  |  |
| materializer | 按职责写 Sandbox creator、Provider builder、cache restorer、payload reader 或 resource factory；代码标识符写进反引号 | 施动者名称没有说明它创建、构建、恢复或读取什么对象 |  |  |
| Attachment persistence version | Attachment persistence revision | 同一 family 的持久化解释只沿 numeric revision 与相邻 migration 演进；version 会与包、API 和 Record root format 混淆。 | docs |  |
| 传输粘合 | 写明 Adapter 的具体职责，例如「请求应用接口」「填写应用接口和审批接口地址」 | 内部架构简称没有告诉读者要写什么代码，也没有说明连接的是哪个接口 | apps/docs-site/zh |  |
| 停轮判定 | 写清可观察行为，例如「当前 Turn 等待用户选择」 | 名词串把谁在等待、等待什么和用户下一步做什么都省略了 | apps/docs-site/zh |  |
| 逐字节未变 | 应用代码没有改动 / 接入过程没有修改应用代码 | 实现核对口吻比用户文档需要的精度更强，却没有直接说明接入是否要求修改应用 | apps/docs-site/zh |  |
| 门控 | 需要审批 / 由某个条件控制——写出条件与结果 | 内部抽象词省略了触发条件和用户可观察到的行为 | apps/docs-site/zh |  |
| 沙箱 | 写 Sandbox；需要说明实现时写 Docker、Vercel 或 E2B Provider | 公开站把 Sandbox 作为固定领域对象，中文别名会让读者误以为存在另一层抽象 | apps/docs-site/zh |  |
| 封口 | 写读者能观察到的结果，例如「Attempt 已发布」「结果已保存」「分数已算出」 | 内部状态机用语，读者不知道封住了什么、之后能做什么 | apps/docs-site/zh |  |
| 闭合 | 直接写结果是什么，例如「完整结果」「固定的查询结果」 | 设计契约里的限定词，对读者没有可操作的含义 | apps/docs-site/zh |  |
| 下钻 | 写具体动作，例如「查看这个 Attempt 的对话」「展开一项工具调用」 | 界面行话，没有说明要点哪里、看到什么 | apps/docs-site/zh |  |
| 三件套 | 直接列出文件：Adapter、Experiment 和评估用例 | 内部口头简称，第一次读的人不知道指哪三件 | apps/docs-site/zh |  |
| canonical | 写「项目里的 .niceeval/record.sqlite」或「原始结果文件」 | 实现层术语，读者只需要知道是哪一个文件 | apps/docs-site/zh |  |
| sealed | 写「已发布」「已保存」 | 内部状态名，公开站用中文说明可观察结果 | apps/docs-site/zh |  |
| opaque | 写「不要解析它，原样传给下一条命令」 | 协议设计用语，没有告诉读者该怎么处理这个值 | apps/docs-site/zh |  |
| expected slots | 写「这次计划要跑的所有 Attempt」 | 内部数据模型名词，读者关心的是要跑哪些、跑了哪些 | apps/docs-site/zh |  |
| 心智模型 | 写「工作方式」「怎么运作」 | 抽象说法，直接说明它怎么运作更好懂 | apps/docs-site/zh |  |
| 准备前缀 | before 缓存 | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| setup prefix | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| SetupPrefix | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| setupPrefixes | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| setupPrefixPlan | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| sandboxCache.setup | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| SandboxSetupCache | Before cache | 0.19 当前术语采用 docs/concepts.md#before-cache；历史存档保留当时用语。 | docs |  |
| SetupPrefixKey | BeforeCacheKey | 0.19 当前术语采用 docs/concepts.md#before-cache-key；历史存档保留当时用语。 | docs |  |
| 并发位 | 并发名额 | 0.19 当前术语采用 docs/concepts.md#concurrency-capacity；历史存档保留当时用语。 | docs |  |
| Concurrency slot | Concurrency capacity | 0.19 当前术语采用 docs/concepts.md#concurrency-capacity；历史存档保留当时用语。 | docs |  |
| waiting for a slot | Concurrency capacity | 0.19 当前术语采用 docs/concepts.md#concurrency-capacity；历史存档保留当时用语。 | docs |  |
| 执行槽位 | 计划 Attempt | 0.19 当前术语采用 docs/concepts.md#planned-attempt；历史存档保留当时用语。 | docs |  |
| slotId | Planned attempt | 0.19 当前术语采用 docs/concepts.md#planned-attempt；历史存档保留当时用语。 | docs |  |
| expectedSlots | Planned attempt | 0.19 当前术语采用 docs/concepts.md#planned-attempt；历史存档保留当时用语。 | docs |  |
| originSlotId | Planned attempt | 0.19 当前术语采用 docs/concepts.md#planned-attempt；历史存档保留当时用语。 | docs |  |
| modelSlot | Model role | 0.19 当前术语采用 docs/concepts.md#model-role；历史存档保留当时用语。 | docs |  |
| model slot | Model role | 0.19 当前术语采用 docs/concepts.md#model-role；历史存档保留当时用语。 | docs |  |
| ModelSlotSelection | Model role | 0.19 当前术语采用 docs/concepts.md#model-role；历史存档保留当时用语。 | docs |  |
| defineModelSlots | Model role | 0.19 当前术语采用 docs/concepts.md#model-role；历史存档保留当时用语。 | docs |  |
| modelSlots | Model role | 0.19 当前术语采用 docs/concepts.md#model-role；历史存档保留当时用语。 | docs |  |
| postSetup | before | 0.19 当前术语采用 docs/concepts.md#before-hook；历史存档保留当时用语。 | docs |  |
| preTeardown | after | 0.19 当前术语采用 docs/concepts.md#after-hook；历史存档保留当时用语。 | docs |  |
| AgentTeardown | after | 0.19 当前术语采用 docs/concepts.md#after-hook；历史存档保留当时用语。 | docs |  |
| SessionSlot | SessionKey | 0.19 当前术语采用 docs/concepts.md#session-key；历史存档保留当时用语。 | docs |  |
| createSessionSlot | SessionKey | 0.19 当前术语采用 docs/concepts.md#session-key；历史存档保留当时用语。 | docs |  |
| session slot | SessionKey | 0.19 当前术语采用 docs/concepts.md#session-key；历史存档保留当时用语。 | docs |  |
| recipe slot | recipe input | 0.19 当前术语采用 docs/concepts.md#recipe-input；历史存档保留当时用语。 | docs |  |
| o11y | Observability | 0.19 当前术语采用 docs/concepts.md#observability；历史存档保留当时用语。 | docs |  |
| O11ySummary | Observability | 0.19 当前术语采用 docs/concepts.md#observability；历史存档保留当时用语。 | docs |  |
| apiBase | baseUrl | 0.19 当前术语采用 docs/concepts.md#base-url；历史存档保留当时用语。 | docs |  |
| AgentSetupManifest | Agent installation | 0.19 当前术语采用 docs/concepts.md#agent-installation；历史存档保留当时用语。 | docs |  |
| reportSetup | Agent installation | 0.19 当前术语采用 docs/concepts.md#agent-installation；历史存档保留当时用语。 | docs |  |
| agentSetup | Agent installation | 0.19 当前术语采用 docs/concepts.md#agent-installation；历史存档保留当时用语。 | docs |  |
| Experiment setup | Experiment before | 0.19 生命周期字段采用 docs/concepts.md#before-hook；普通英文动词与仓库安装名称不受此规则限制。 | docs |  |
| Experiment teardown | Experiment after | 0.19 生命周期字段采用 docs/concepts.md#after-hook；普通英文动词与仓库安装名称不受此规则限制。 | docs |  |
| setup / teardown | before / after | 0.19 生命周期字段采用 docs/concepts.md#before-hook；普通英文动词与仓库安装名称不受此规则限制。 | docs |  |
| setup 字段 | before 字段 | 0.19 生命周期字段采用 docs/concepts.md#before-hook；普通英文动词与仓库安装名称不受此规则限制。 | docs |  |
| teardown 字段 | after 字段 | 0.19 生命周期字段采用 docs/concepts.md#after-hook；普通英文动词与仓库安装名称不受此规则限制。 | docs |  |

## 检查范围

- docs
- apps/docs-site/zh
