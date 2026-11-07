# native plugin 的 `marketplace.name` 不是调用方能自定的连接名,真实 CLI 按 manifest 自己的 `name` 注册

**现象**：`ClaudeCodePluginSpec.marketplace.name` / `CodexPluginSpec.marketplace.name` 的 TSDoc
与 `docs/feature/adapters/coding-agent-skills-plugins.md`「Claude Code Native Plugin」/「Codex
Native Plugin」两节都写「Marketplace 在 Claude Code / Codex 配置中的连接名」,暗示这是调用方
任意选的标识,`installPlugins` 也确实拿它去拼 `${plugin.name}@${marketplace.name}` 建 install id
(`src/agents/claude-code.ts:171`、`src/agents/codex.ts:212`)。

用真实 CLI(本机 `claude` 2.1.207、`codex-cli` 0.144.1)对着两个真实公开 Marketplace 仓库复现:
- Claude Code:clone 到本地后 `claude plugin marketplace add <本地路径>`(用 `CLAUDE_CONFIG_DIR`
  隔离出临时配置目录,不碰宿主机 `~/.claude.json`),返回 `Successfully added marketplace:
  duyet-claude-plugins`——这个名字来自该仓库自己的 `.claude-plugin/marketplace.json` 里的
  `"name"` 字段,不是我传的路径、也不是我"打算"叫它的任何名字(CLI 的 `marketplace add`
  只有 `--scope`/`--sparse`,没有 `--name`/`--as` 之类的别名 flag)。
- Codex:同理,`CODEX_HOME` 隔离后 `codex plugin marketplace add duyet/codex-claude-plugins --ref <sha>
  --json` 返回 `"marketplaceName": "duyet-claude-plugins"`,同样取自 `.agents/plugins/marketplace.json`
  的 `"name"`,`marketplace add` 的 flag 里也没有能覆盖这个名字的入口。

如果调用方在 `SkillSpec`/`PluginSpec` 里按契约文档的暗示随便起一个 `marketplace.name`(比如
现有单测和文档示例里全用的占位符 `"acme"`),`marketplace add` 这一步会**成功**(exit 0,静默
注册成仓库自己的真实名字,和调用方想要的名字无关),但紧接着 `plugin install <name>@acme` /
`plugin add <name>@acme` 一定会失败:
```
Failed to install plugin "commit@acme": Plugin "commit" not found in marketplace "acme".
Error: plugin `commit` was not found in marketplace `acme`
```
即"安装两步的第一步骗过了错误检测,第二步才报错"——`installPlugins` 现在的失败语义
(`marketplaceFailed` 只在 `marketplace add` 非零退出时抛)完全接不住这种情况,只会在
`plugin install`/`plugin add` 那一步抛 `installFailed`,报错信息里点名的是调用方瞎起的
`marketplace.name`,不会提示"这个名字其实不是仓库注册后的真实名字"。

**根因**：设计时把「Marketplace 连接名」类比成前面 Skill 的 `source`(纯调用方自定的标识符),
但两家 CLI 的 native plugin marketplace 协议实际上要求 marketplace 自带一份 manifest
(`.claude-plugin/marketplace.json` / `.agents/plugins/marketplace.json`)且其中的 `"name"`
字段就是全局唯一注册名,`marketplace add` 无法为它取别名。`marketplace.name` 唯一还成立的
用法是:调用方**提前查过目标仓库 manifest 里的真实 `name`,原样填进配置**——这时它凑巧「像」
一个调用方选的标识,实际是在抄别人已经定好的值。

**影响范围**:只影响 native plugin(`installPlugins`),不影响 Skill(`installSkills` 走
`git clone` + `find SKILL.md` + `cp -R`,不经过任何 marketplace 注册协议,不受此限制)。
`src/agents/claude-code.test.ts` / `src/agents/codex.test.ts` 的单测全部用 `FakeSandbox`
(canned `runShell`,不真的解析 marketplace manifest),测试不出这个偏差——这正是这条 memory
存在的原因:两边单测和文档示例现在都用 `marketplace: { name: "acme", source: "acme/xxx-plugins" }`
这种"名字与 source 无关"的写法,如果真的照着这个示例接一个真实仓库,会在 `plugin add` 这步
100% 失败。

**已知安全的复现候选**(未来要补 Docker 真机 e2e 时可直接用,两者都在同一仓库、同一 ref,
同时覆盖 Claude Code 与 Codex 两侧):`duyet/codex-claude-plugins`(commit
`82de4021a311034a9596e891baf3a8266fb33bf7`),`.claude-plugin/marketplace.json` 与
`.agents/plugins/marketplace.json` 的 `"name"` 都是 `"duyet-claude-plugins"`,最小 plugin
`commit`(纯 slash command,无 MCP/无 App/无需鉴权,`claude plugin install commit@duyet-claude-plugins`
与 `codex plugin add commit@duyet-claude-plugins` 均已本机验证成功,非 tty 环境下都没有卡在
确认框——[[skill-install-via-git-not-skills-cli]] 担心的「`claude plugin install` 无 `-y` 可能
弹确认」这一条,在这两个真实仓库上没有复现,装的是纯 slash-command 或纯 skill 型 plugin 时
没有额外确认步骤)。`anthropics/claude-plugins-official` 不适合做这个复现:它的
marketplace 名字 `openai-curated`(对应的官方 Codex marketplace 仓库 `openai/plugins`)是
Codex CLI 内置的保留名,`codex plugin marketplace add openai/plugins`(无论本地路径还是远程
`owner/repo` 形态)恒失败于 `Error: marketplace \`openai-curated\` is reserved and cannot be
added from this source`——找真实仓库复现这条 memory 时也顺带踩出了这一条,一并记录避免重踩。

**修法建议(未落地,留给下一个改这段代码的人)**:`installPlugins` 装完 marketplace 后,应该用
`claude plugin marketplace list --json` / `codex plugin marketplace list --json` 回读真实注册
名,而不是假定等于 `marketplace.name`;后续 `plugin install`/`plugin add` 与 manifest 里落的
`marketplace.name` 都应该用回读到的真实名字,不是配置里原样抄来的字符串。或者更彻底:文档和
类型改成明确要求「`marketplace.name` 必须等于目标仓库 manifest 里的 `name`」,并在 setup 时
用 `marketplace list --json` 校验两者一致、不一致时 fail fast 报出真实名字,而不是让错误在
下一步的 `plugin install` 里以「找不到 marketplace」的形式间接暴露。

适用场景:任何要给 `ClaudeCodePluginSpec`/`CodexPluginSpec` 接真实第三方 Marketplace 仓库的场景;
写 native plugin 真机 e2e fixture 时必须先 `git clone` 目标仓库看一眼 manifest 里的 `"name"`,
不能照抄文档示例里的占位符名字。

关联:[[skill-install-via-git-not-skills-cli]](同一条"native plugin 未经真机验证"担忧的具体化
与部分证伪:TTY 卡死风险在两个真实仓库上未复现,但发现了这条更根本的命名偏差)、
[[structural-typing-cannot-reject-spec-swap]](同一对类型的另一个未决问题:结构类型拦不住
`ClaudeCodePluginSpec`/`CodexPluginSpec` 互换,与本条"值语义错误"是两个不同维度的缺口)、
[[codex-plugin-list-json-shape-guessed-wrong]]、[[brief-crashes-on-preview-undefined]](用本条
记录的复现候选补上真机 e2e 时,连带挖出并修复的另外两个真实 bug)。

**补记(2026-07-13,同一次任务内追加)**:本条记录的复现候选(`duyet/codex-claude-plugins`
commit `82de4021a311034a9596e891baf3a8266fb33bf7`,plugin `commit`)已经真正落成 Docker 真机
e2e——`e2e/projects/claude-code/{agents,experiments,evals}/*native-plugin*` 与
`e2e/projects/codex/{agents,experiments,evals}/*native-plugin*`,`marketplace.name` 按本条结论
原样填 `"duyet-claude-plugins"`(即用「已知目标仓库的真实 manifest 名」这个唯一生效用法),两条
`node ../../../bin/niceeval.js exp native-plugin --force` 均已各跑通两次并经
`verify-agent-setup.mts` 深等验证。**本条描述的 bug 本身没有修**(`marketplace.name` 仍然要求
调用方自己查好真实名字填对,类型和运行期都不校验),继续适用于任何新接的第三方 Marketplace。
