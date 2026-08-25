# Coding Agent 扩展边界

可持久且具有精确 repository provenance 的原生 Plugins 在 Agent-owned before action 中收敛；Skills、MCP servers、凭据与
本 Attempt 的模型/runtime 配置仍由私有 setup 写入。Claude Code / Codex marketplace ref 先经 identity lookup 得到完整 commit。
Adapter 只有在探测命令能验证相同 provenance 时才恢复或跳过安装；不能验证时标记 `unsupported` 并保守重装。

Record 只通过 Attempt-owned 具名通道保存安装 manifest，不理解每个 Agent 的配置目录、Marketplace 或包管理器；安装结果不进入 Attempt 核心。

## 类型边界

`SkillSpec` 只统一 Skill 出处：本地路径或带可选 ref/选择列表的仓库。
安装位置和发现机制由 Adapter 决定。

MCP 使用共享 `McpServer` 形状——stdio 形态（`command`/`args`/`env`）与 Streamable HTTP 形态（`url`/`headers`）组成按形状判别的联合，不设 kind 标签：两种形态各有唯一的必填判别字段（`command` / `url`），标签只会重复这个事实。
Claude Code 与 Codex 都能原生表达两种 transport；Bub 没有该构造字段。

落位由 Adapter 决定。
Claude Code 写用户级 `~/.claude.json`，HTTP 形态带 `type: "http"` 与 `headers`；Codex 写 `[mcp_servers.<name>]` 表，HTTP 形态写 `url`，headers 进 `[mcp_servers.<name>.http_headers]` 子表。
同一个 server 同时给出 `command` 与 `url` 时，setup 报错点名该 server，不做静默取舍。

`postSetup` 是 factory 上的动态过程 Hook 数组：Adapter 全部安装步骤（含写 manifest）完成后，在沙箱里按数组顺序运行用户代码。
它复用 prepare command 的 `SandboxCommand` 形状与窄上下文（`SandboxCommandContext`，见 [Sandbox Layer](../../sandbox/layers.md#command-形状与-identity)）。
agent 安装后脚本和沙箱准备命令是同一类「在沙箱里跑一段用户代码」，区别只有相对 agent 安装的时机，不值得第二套类型。

成对的 `preTeardown` 数组承载收尾:按逆序、先于 agent teardown 执行(LIFO 镜像)。
它不是配置声明：factory 已有字段能表达的 MCP、Skills 与 Plugin 不进 Hook。固定且只依赖 Plugin 文件的安装后命令写在 Plugin 的 `install.after`，成为依赖该 Plugin 安装 capability 的声明式 action；`postSetup` 只承载 secret、cohort、远端会话或其它每 Attempt 动态动作。

Native Plugin 不统一：Claude Code 和 Codex 使用各自的 PluginSpec，Bub 使用 PythonPluginSpec；DSH 与
OpenClaw 接受各自原生命令可安装的精确 npm `package@version` 字符串。
一个 Agent 不支持的扩展类型不出现在其 config 上。

原生配置是 Sandbox coding-agent Adapter 契约的标准组成，但不跨 Agent 统一字段名或数据表示。
Claude Code factory 提供 `settingsFile?: string`，指向官方 JSON settings 文件；Codex factory 提供 `configFile?: string`，指向官方 TOML config 文件；没有原生配置文件的 Agent（如 Bub）config 上没有对应字段。
core 不定义设置词汇，也不为单个行为需求铸语义字段：新需求先看 CLI 原生配置能不能表达，能表达就直接写进官方配置文件，不能表达的去上游提，不在 niceeval 造中间层。

两个字段都是运行 niceeval 的机器上的本地文件路径，不是 Sandbox 内路径。
项目根固定为启动 niceeval 进程时的 `process.cwd()`，也就是包含 `niceeval.config.ts` 的目录；Eval、Experiment 与 Agent 声明文件的位置不改变配置根。
路径语法是项目根内的相对路径：允许普通相对路径和 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`；Adapter 解开符号链接后的真实路径也必须位于项目根内。

Adapter 从本地读取原始字节，再上传到 Sandbox 的固定用户配置位置。
文件是完整用户配置层，不是 patch：Adapter 在隔离的 Agent 配置目录中创建空用户层，再用输入文件的原始字节替换它；不继承宿主机配置，不拼接、deep merge 或重新序列化。
Adapter 只读文件验证官方语法和保留键，验证后仍写入原始字节，因此 JSON Schema 标记、TOML 注释和官方编辑器支持都保留。
仓库内的项目级配置仍由被测 CLI 按自己的官方优先级读取。

Adapter 拥有的模型、鉴权、OTel 导出与 MCP 配置通过独立生成层、独立原生文件或 CLI 参数叠加，不改写用户文件。
保留键规则对所有 Adapter 是同一套：由 experiment 与 Adapter 拥有的键出现在用户配置文件里时，setup 立刻报错并点名冲突键，不做静默改写。
逐 Agent 的保留键清单在各自的 SDK 页。

TypeScript 是结构类型系统；两个供应商 Spec 恰好同形时，类型系统无法根据 marketplace source 的值判断是否传错。
归属由字段所在的 factory 确定，实际出处是否合法由 Adapter setup 校验。

`marketplace.name` 不是调用方任意起的连接别名：真实 CLI 在 `marketplace add` 时按目标仓库自己 manifest 里的 `name` 注册，名字对不上时 add 静默成功、直到下一步 `plugin install <plugin>@<name>` 才失败。
因此契约是 **`marketplace.name` 必须等于目标仓库 manifest 声明的 `name`**；Adapter setup 在 add 之后回读已注册的 marketplace 列表校验这个名字，对不上立刻抛出带两个名字的错误，不把失败拖延到 install 一步。

## 安装顺序

1. 从本地项目根读取官方配置文件，创建隔离的 Agent 配置目录；按官方语法校验后原样上传为完整用户层（保留键冲突在这一步报错）。
2. 用独立层或 CLI 参数准备模型、鉴权、MCP 与 OTel 配置。
3. 安装 Skills。
4. 查找 Plugin ref 对应的完整 commit，满足可恢复的 checkout、安装与声明式安装后 action；无法验证 provenance 时真实收敛。
5. 写公开 Agent 配置与安装 manifest。
6. 注入 secret、cohort 与本 Attempt 配置，按序运行动态 `postSetup` Hook。
7. 通过 `agent.ensure` 屏障后启动 Agent。

每个 attempt 只执行一次。
多轮 `send` 不重复安装。
`postSetup` 排在 manifest 之后：manifest 审计的是 Adapter 自身的安装 channel event，Hook 失败也不该丢掉这份证据；Hook 做了什么由命令 channel event 与 timing decoder 留存。

## 安装收敛：不假设沙箱空白

扩展状态每条 attempt 都验证一次，但可验证的持久原生 Plugin 不必每次安装：Runner 先执行只读探测命令，
只有声明的精确 package/version、启用集合或可加载状态不匹配时，才调用 identity 精确配对的 installer，随后复检。
Sandbox 复用下，沙箱带着上一条 attempt 的 `$HOME` 残留进场（生命周期见 [Sandbox 复用](../../sandbox/reuse.md)）。
因此安装步骤的语义是**把沙箱状态收敛到声明**，不是在空白沙箱上追加：每一步在「目标已存在、部分存在、出处不同」的沙箱上，都要得到与空白沙箱相同的结果。

文件类安装天然收敛：原生配置、Skills 与 MCP 配置以整层替换写入落位，重复执行结果不变。
注册类安装（marketplace 注册、Plugin 安装）是追加式命令，由 Adapter 主动收敛：

- marketplace：每条 attempt 先按声明名字执行一次摘除，再按声明的 source 与 ref 添加。
- Plugin：与声明同名的已安装 Plugin 先移除（不论出自哪个 marketplace），再从刚注册的声明 marketplace 安装。

marketplace 的摘除不以「注册在回读列表里可见」为前提。
注册状态分两半：用户配置里的注册项，和磁盘上的 marketplace 数据。
安装顺序第 1 步的原生配置整层替换会抹掉前一半；残下的后一半回读列表报告不出来，add 却会撞它报「同名不同源」（复用沙箱第二条 attempt 真机复现）。
因此摘除按声明名字无条件执行：「本就没有可摘的」按已收敛处理，摘除的其它失败也不单独报错，紧随其后的 add 是权威失败面。

Adapter 用 unchecked `runCommand()` / `runShell()` 执行这类摘除，让原始非零退出以 `checked: false` 事实保留，消费层显示为 `observed`。
不能使用 `runCommandOrThrow()` / `runShellOrThrow()`，也不能把退出码改写成零。Runner 与 Reports 必须保留 unchecked / checked 的区别，不能把 Adapter 已接管解释权的非零结果冒充成 setup 失败。

不比对出处、相同就跳过：注册表里的出处字符串可能是同一出处的另一种写法——插件自带的 setup 脚本把注册改写成托管源是正常生态行为。
判断两个出处等价，要理解每个 CLI 各自的出处规范化规则；按名字摘除重加只依赖名字这一个事实。
同理，同名不同源也不当配置错误报出：它在复用沙箱上是常态，报错会让带这类脚本的插件永远无法与复用组合。

Claude Code / Codex marketplace Plugin 只有在 Adapter 能从供应商探测与磁盘 manifest 双向验证完整 commit、sparse 选择、插件名和安装协议时才能命中。当前 CLI 无法提供足够 provenance 时仍不跳过重装。
DSH / OpenClaw 的精确 npm Plugin 则以原生 profile/install record、实际 package version、启用集合与加载检查
共同命中；派生镜像预装或复用 Sandbox 中的同一状态会得到 `hit`，缺失或不一致才得到 `installed`。
插件声明顺序、精确版本、安装协议修订与安装模式都进入 Agent install identity，插件集合不同不会误用旧结果。

收敛的对象只有安装文件。
Plugin 安装目录每条 attempt 都被重装覆写：Plugin 运行期要跨 attempt 留下的数据，必须写在安装目录之外的路径。
这条边界与复用契约的 `$HOME` 残留语义同构：残留是否可接受由实验作者裁决，安装文件与声明同源由 Adapter 保证。

## 可复现性

- Repo Skill 和 Marketplace ref 在每次 Invocation 内经 identity lookup 得到完整 commit 并冻结；完整 commit 可以跳过远端 ref 查询。
- 多 Skill 仓库必须显式选择，除非仓库只有唯一 Skill。
- 同名 Skill 来自多个出处时按配置顺序安装，manifest 保留每个出处，不静默合并。
- 安装前缀 key 必须包含所有影响 Sandbox 的配置，包括完成态 commit、sparse 选择、Bub Python packages，以及原生配置文件原始字节的 SHA-256；内容不同的两个配置文件不复用同一份安装状态。

固定 Plugin、动态 overlay 与真实收尾的完整拆分见[原生 Agent Plugin](../../../roadmap/sandbox-cache/setup-prefix/use-case/原生AgentPlugin.md)。

## 失败语义

下列失败都在 `agent.ensure` 相位形成结构化执行错误通道事件 与该 Attempt 的 `errored` Verdict：路径不存在、包含 `..`、不是相对路径、使用 `~` 或经符号链接逃出项目根,以及原生配置语法错误或含保留键。Attempt lifecycle 不使用 verdict token。
仓库无法拉取、Skill 选择歧义、Plugin 不存在、MCP 配置无法写入、MCP server 同时给出 `command` 与 `url`、安装命令失败或 `postSetup` Hook 抛错,同样归这一相位。
只有 Agent 已开始执行任务后的行为失败才进入 Turn status。

## Manifest

Adapter 通过共享 manifest writer 写入安装事实，Runner 将其提交为 Attempt stream 的安装 channel event。

- 原生配置只记 Agent 名、项目相对出处路径和原始字节的 SHA-256，不记配置正文。
  任意官方配置都可能携带敏感字符串，不能靠字段白名单证明适合原样落盘。
- MCP 条目同理只记非 secret 字段：stdio 形态记 `name` / `command` / `args`，不记 `env`。
  HTTP 形态记 `name` / `url`，不记 `headers`。
- `postSetup` Hook 是用户代码，不进 manifest。

Manifest 是审计结果，不参与能力分发，也不能替代实际行为事件。
例如，Skill 是否被模型使用仍需 `skill.loaded` 或任务结果证据。
