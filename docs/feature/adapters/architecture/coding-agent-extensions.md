# Coding Agent 扩展边界

Skills、MCP servers 和原生 Plugins 在 Agent setup 阶段安装。core 只保存安装 manifest，不理解每个 Agent 的配置目录、Marketplace 或包管理器。

## 类型边界

`SkillSpec` 只统一 Skill 来源：本地路径或带可选 ref/选择列表的仓库。安装位置和发现机制由 Adapter 决定。

MCP 使用共享 `McpServer` 形状——stdio 形态（`command`/`args`/`env`）与 Streamable HTTP 形态（`url`/`headers`）组成按形状判别的联合，不设 kind 标签：两种形态各有唯一的必填判别字段（`command` / `url`），标签只会重复这个事实。Claude Code 与 Codex 都能原生表达两种 transport；Bub 没有该构造字段。落位由 Adapter 决定：Claude Code 写用户级 `~/.claude.json`（HTTP 形态带 `type: "http"` 与 `headers`），Codex 写 `[mcp_servers.<name>]` 表（HTTP 形态写 `url`，headers 进 `[mcp_servers.<name>.http_headers]` 子表）。同一个 server 同时给出 `command` 与 `url` 时，setup 报错点名该 server，不做静默取舍。

`postSetup` 是 factory 上的过程钩子数组：Adapter 全部安装步骤（含写 manifest）完成后，在沙箱里按数组顺序运行用户代码。它复用 `SandboxHook` 类型与窄上下文——agent 安装后脚本和沙箱环境预置是同一类「在沙箱里跑一段用户代码」，区别只有相对 agent 安装的时机，不值得第二套类型。钩子返回的 cleanup 按 LIFO 与 agent teardown 一起收尾。它不是配置声明：factory 已有字段能表达的（MCP、Skills、Plugin）不进钩子，钩子只承载「安装产物就位后才能跑」的过程动作（如运行插件自带的 setup 脚本）。

Native Plugin 不统一：Claude Code 和 Codex 使用各自的 PluginSpec，Bub 使用 PythonPluginSpec。一个 Agent 不支持的扩展类型不出现在其 config 上。

原生配置是 Sandbox coding-agent Adapter 契约的标准组成，但不跨 Agent 统一字段名或数据表示。Claude Code factory 提供 `settingsFile?: string`，指向官方 JSON settings 文件；Codex factory 提供 `configFile?: string`，指向官方 TOML config 文件；没有原生配置文件的 Agent（如 Bub）config 上没有对应字段。core 不定义设置词汇，也不为单个行为需求铸语义字段：新需求先看 CLI 原生配置能不能表达，能表达就直接写进官方配置文件，不能表达的去上游提，不在 niceeval 造中间层。

两个字段都是运行 niceeval 的机器上的本地文件路径，不是 Sandbox 内路径。项目根固定为启动 niceeval 进程时的 `process.cwd()`，也就是包含 `niceeval.config.ts` 的目录；Eval、Experiment 与 Agent 声明文件的位置不改变解析根。路径语法是项目根内的相对路径：允许普通相对路径和 `./` 前缀，不允许 `..` 路径段、绝对路径或 `~`；Adapter 解析符号链接后的真实路径也必须位于项目根内。Adapter 从本地读取原始字节，再上传到 Sandbox 的固定用户配置位置。文件是完整用户配置层，不是 patch：Adapter 在隔离的 Agent 配置目录中创建空用户层，再用输入文件的原始字节替换它；不继承宿主机配置，不拼接、deep merge 或重新序列化。Adapter 只解析文件以验证官方语法和检查保留键，验证后仍写入原始字节，因此 JSON Schema 标记、TOML 注释和官方编辑器支持都保留。仓库内的项目级配置仍由被测 CLI 按自己的官方优先级读取。

Adapter 拥有的模型、鉴权、OTel 导出与 MCP 配置通过独立生成层、独立原生文件或 CLI 参数叠加，不改写用户文件。保留键规则对所有 Adapter 是同一套：由 experiment 与 Adapter 拥有的键出现在用户配置文件里时，setup 立刻报错并点名冲突键，不做静默覆盖。逐 Agent 的保留键清单在各自的 SDK 页。

TypeScript 是结构类型系统；两个供应商 Spec 恰好同形时，类型系统无法根据 marketplace source 的值判断是否传错。归属由字段所在的 factory 确定，实际来源是否合法由 Adapter setup 校验。

`marketplace.name` 不是调用方任意起的连接别名：真实 CLI 在 `marketplace add` 时按目标仓库自己 manifest 里的 `name` 注册，名字对不上时 add 静默成功、直到下一步 `plugin install <plugin>@<name>` 才失败。因此契约是 **`marketplace.name` 必须等于目标仓库 manifest 声明的 `name`**；Adapter setup 在 add 之后回读已注册的 marketplace 列表校验这个名字，对不上立刻抛出带两个名字的错误，不把失败拖延到 install 一步。

## 安装顺序

1. 从本地项目根解析并读取官方配置文件，创建隔离的 Agent 配置目录；解析、校验后原样上传为完整用户层（保留键冲突在这一步报错）。
2. 用独立层或 CLI 参数准备模型、鉴权、MCP 与 OTel 配置。
3. 安装 Skills。
4. 安装供应商原生 Plugin / Python package。
5. 写安装 manifest。
6. 按序运行 `postSetup` 钩子。

每个 attempt 只执行一次。多轮 `send` 不重复安装。`postSetup` 排在 manifest 之后：manifest 审计的是 Adapter 自身的安装事实，钩子失败也不该丢掉这份证据；钩子做了什么由 attempt 的命令时间树记录。

## 可复现性

- Repo Skill 和 Marketplace 可以固定 ref。
- 多 Skill 仓库必须显式选择，除非仓库只有唯一 Skill。
- 同名 Skill 来自多个来源时按配置顺序安装，manifest 保留每个来源，不静默合并。
- 安装 checkpoint key 必须包含所有影响环境的配置，包括 Bub Python packages，以及原生配置文件原始字节的 SHA-256；内容不同的两个配置文件不复用同一份安装缓存。

## 失败语义

路径不存在、包含 `..`、不是相对路径、使用 `~` 或经符号链接逃出项目根，原生配置语法错误或含保留键，仓库无法拉取、Skill 选择歧义、Plugin 不存在、MCP 配置无法写入、MCP server 同时给出 `command` 与 `url`、安装命令失败或 `postSetup` 钩子抛错，都在 setup 阶段抛出并使 attempt errored。只有 Agent 已开始执行任务后的行为失败才进入 Turn status。

## Manifest

Adapter 通过共享 manifest writer 记录安装事实，runner 将其提升为 attempt artifact。原生配置只记录 Agent 名、项目相对来源路径和原始字节的 SHA-256，不记录配置正文；任意官方配置都可能携带敏感字符串，不能靠字段白名单证明适合原样落盘。MCP 条目同理只记非 secret 字段：stdio 形态记 `name`/`command`/`args` 不记 `env`，HTTP 形态记 `name`/`url` 不记 `headers`。`postSetup` 钩子是用户代码，不进 manifest。Manifest 是审计结果，不参与能力分发，也不能替代实际行为事件；例如 Skill 是否被模型使用仍需 `skill.loaded` 或任务结果证据。
