# 编译期作者契约

NiceEval 的 TypeScript 作者面同时包含作者声明、框架派生值和运行时数据。
这三类事实各有自己的类型，静态可判定的约束落在调用点上。

运行时校验覆盖 JavaScript、类型断言、动态导入和 JSON 往返，不承担 TypeScript 作者面的第一道反馈。

作者按顺序遇到三级反馈：编辑器里的 tsc 诊断、加载文件时的守卫消息、discovery 之后动资源之前的 link 结果。
三级各自负责哪一类事实见 [Library](library.md#三级反馈)，一次改动依次撞上三级的走查见 [三级反馈走查](use-case/three-levels.md)。

## 解决的问题

三类事实共用一个宽接口时，TypeScript 会接受文档已经禁止的组合，错误只能等到模块装载、Agent setup 或报告渲染时出现。
具体是四种形态：

1. 作者被禁止填写的派生字段作为可选字段出现在输入类型中。
2. 两个字段要求二选一或共同出现，类型却把它们分别声明为 optional。
3. 两组对象键或字段值存在关系，泛型只描述返回值，没有约束调用参数。
4. 宿主只接受 `define*` 产物，公开类型却可以由普通对象按结构伪造。

这些形态让错误反馈远离出错调用点，也让文档中的“禁止”“二选一”和“只收 factory 产物”无法由 TypeScript 证明。

## 核心心智

每条事实只由一个 owner 声明：

| 事实 | owner | 校验位置 |
|---|---|---|
| 作者选择的 agent、page、字段和计算 | 作者输入 | TypeScript；运行时作无类型后备 |
| 路径生成的 id、factory 生成的 scoring、规划生成的 configHash | 发现器、factory、规划器 | 对应阶段构造，不回流到作者输入 |
| 文件是否存在、URL 是否可达、请求 options 的实际成员 | 运行时资源 | 运行时 |
| JSON 行的真实结构、跨行一致性和数值关系 | 数据读取边界 | 运行时 |
| 实际 Eval × Experiment 是否恰好一份 Sandbox template | discovery、selector 与 CLI filter 形成的配对 | 资源前 linker；`niceeval check` 与正常运行共用 |

类型使用四种固定工具：

- **阶段类型**：作者输入、定义产物、发现结果和规划结果使用不同类型。
- **穷尽联合**：二选一与字段依赖使用 union，并用 `never` 排除另一分支字段。
- **关系泛型**：键冲突、字段存在性和值类别由输入泛型计算。
- **不可伪造品牌**：只允许 factory 产生的定义带模块私有 `unique symbol`。

排除一个字段有两种写法，选哪种看这个字段会不会被读回。
`never` 让消费侧读到 `string | undefined`，用于 union 成员的负字段；模块私有诊断类型让错误文本携带原因，用于不会被读回的作者输入字段。
两种写法的诊断对照见 [Library](library.md#禁止字段的两种写法)。

## 阶段类型的名字

一个 Eval 定义经过三个阶段，每个阶段一个名字：

| 阶段 | 类型 | 谁构造 |
|---|---|---|
| 作者输入 | `EvalInput` / `ScoreEvalInput` | 作者写在 `defineEval()` / `defineScoreEval()` 的实参里 |
| 定义产物 | `EvalDefinition<Scoring, Context>` | factory |
| 发现结果 | `DiscoveredEval` | 发现器 |

Experiment 走同一条规则：`ExperimentInput` → `ExperimentDefinition` → `DiscoveredExperiment`。

三个阶段各有其名，`Def` 后缀不进公开类型。
一个名字同时指作者输入、factory 产物与带 id 的发现结果时，读者无法从名字判断手上的值处在哪一阶段。
`id`、`scoring` 与 `configHash` 也只能声明成可选才能同时满足三方，于是“禁止手写”这条规矩没有类型可以表达。

## 契约范围

| 契约族 | 类型形态 | 作者得到的反馈 |
|---|---|---|
| Eval / Experiment | 拆分 Author Input、Definition 与 Discovered 类型；移出 `id`、`scoring`、`configHash` | 禁止字段在 `define*` 调用处报类型错误 |
| Report page | 普通页与参数化页组成 union | `params` 缺 `load` 或 `navigation: false` 时不能编译 |
| MCP server | stdio 与 HTTP 分支互相声明负字段 | `command` 与 `url` 同时出现时不能编译 |
| HITL answer | `optionId` 与 `text` 使用共享 XOR 值类型 | 两者都缺或同时出现时不能编译 |
| Aggregate | 把分组键、读数键和 `refs` 的关系约束放到 options | 冲突键在 `aggregate()` 调用处报错 |
| Evidence row | 输入类型证明至少有一个 `MetricValue` 字段 | 只有维度字段的对象不能编译 |
| Report charts | `x`、`y`、`series`、`point`、`sort.field` 使用按值类型过滤后的键 | 不存在或不可绘制的静态字段不能编译 |
| Agent evidence coverage | 六个通道在 Agent 构造时穷尽声明；partial / unavailable 必须带原因 | 漏通道或无原因的降级无法写出 |
| Custom Sandbox case | callback 返回主 Sandbox、资源组与可选 services；留存不属于临时 callback | 缺基线句柄或拼接 retention 的形状无法写出 |
| Theme / Report definition | factory 产物带模块私有品牌 | 普通对象不能冒充宿主可装载定义 |
| Sandbox layer | template factory 与 Provider 原子绑定；kind 品牌区分 template-bearing 与 command-only | 单个 layer 的非法形状在调用点失败；跨配对的 1×1 / 0×0 在 linker 一次报全 |

精确类型与调用形状见 [Library](library.md)。
阶段边界、运行时镜像和行为矩阵见 [Architecture](architecture.md)。

## 编译期的真实边界

不能把“TypeScript 没法跨模块证明”当成把错误拖进 Sandbox 的理由，也不能为了让泛型看见整个矩阵，反过来要求 Experiment 静态 import 所有 Eval。

一个 Eval 的 `dockerComposeSandbox(...)` 与另一个 Experiment 的 `e2bSandbox(...)` 各自在本文件里都合法；是否冲突还取决于 discovery、Experiment selector 与 CLI filter 形成的实际配对。普通 `tsc` 在两个独立定义的调用点无法证明这条 XOR。

因此边界固定为两层：

- TypeScript 拒绝单个声明内可知的错误：伪造 layer、非法 factory options、kind 品牌错配，以及在已有 layer 上追加 template / Provider。
- discovery 后的纯 linker 穷举实际 Eval × Experiment 配对；Sandbox Agent 的 1×1 是 `sandbox.template-conflict`，0×0 是 `sandbox.template-missing`。`niceeval check` 与正常运行消费同一个 linker，任何 Provider 网络、fingerprint、build 或 Sandbox create 都在它之后。

这仍是 author-time feedback，只是属于项目级 configuration link，而不是单文件 TypeScript inference。真正的生命周期 command 只负责 shell 能否成功，template 唯一性检查不属于它。

把这条 XOR 前移到 `tsc` 的两种办法都不采用。
值引用 selector（`evals` 接受 Eval 定义值，kind 用条件类型互斥）给“选哪些 eval”开了第二种语义，与 CLI Model 的 id 前缀选择和逐题自包含相抵。
codegen manifest（discovery 生成 eval id 到 kind 的字面量表，模板字面量类型对前缀 selector 求值）引入生成物新鲜度环，与 tsx 直跑、零构建的形态相抵。
资源前 linker 因此是这条约束的唯一权威；只有当 `niceeval check` 的反馈延迟成为真实痛点时才重启裁决。

## 运行时校验仍是契约

编译期约束不删除对应运行时守卫。
JavaScript、`unknown`、动态 import 和显式类型断言仍可能绕过静态类型，因此两层必须拒绝同一类错误。

运行时错误负责以下信息：

- 指出配置文件、server、page、字段或冲突键的真实名字。
- 指出下一步应删除、补充或改写哪个字段。
- 在写文件、启动进程或渲染输出之前失败。

其中跨定义约束必须在资源前 linker 失败；“运行时后备”不等于允许等到 Agent setup 或第一条 Attempt 才失败。

类型系统不负责证明网络可达、文件存在、请求 option 真实存在、数组元素跨行一致或 `samples <= total`。
这些事实依赖运行时值，由现有边界校验。

静态无法证明的动态数据走显式解析入口，不为宽对象保留 overload。
JSON、数据库与外部 API 得到的行经 `parseEvidenceRow()` 完成同一条证明，普通的写错对象因此不会顺着宽签名逃回运行时。
两个入口的分工见 [Library](library.md#动态数据经过独立解析函数)。

## 迁移纪律

NiceEval 处于 beta，宽类型别名不作为保留目标。
公共签名允许破坏性收窄，但运行时接收边界保持可诊断：旧 JavaScript 调用得到明确错误，不因类型重构变成静默取舍。

内部代码依赖宽类型时，改用明确的规范化类型或 discovered 类型，不通过 `as` 把作者输入重新放宽。

## 不在这份契约里的问题

- 不用模板字面量类型校验 URL、CSS、文件路径或十六进制颜色的全部语法。
- 不尝试在 TypeScript 中证明动态 page id 全局唯一或数据数组跨行同构。
- 不改变 Eval、Experiment、Report、Sandbox、MCP 或 HITL 的业务语义。
- 不新增 schema、CLI flag 或运行时序列化字段。
- 不用删掉运行时守卫来证明类型足够严格。

## 入口

- [Library](library.md) —— 各公共类型的形状与正反调用。
- [Architecture](architecture.md) —— 阶段所有权、运行时镜像与行为矩阵。
- [三级反馈走查](use-case/three-levels.md) —— 一个作者依次撞上类型、装载与 link 三层反馈。
