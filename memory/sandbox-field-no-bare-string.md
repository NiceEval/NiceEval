# `sandbox` 字段不接受裸字符串,也没有默认值/按名字选

**决定**(最终版,2026-07-02 同一次会话分两轮做的):`Config.sandbox` / `ExperimentDef.sandbox` 只接受工厂函数产出的 `SandboxSpec`(= `SandboxOption`)。以前支持的两条"隐式"路径全部去掉:

1. **不接受裸字符串**——`sandbox: "docker"` 不再过类型检查,必须 `sandbox: dockerSandbox()`(从 `niceeval/sandbox` 导入 `dockerSandbox`/`vercelSandbox`/`e2bSandbox`/`defineSandbox`)。
2. **省略字段不再等于"自动探测"**——第一轮曾做过"省略 = 按 env 自动选 docker/vercel/e2b"(仿照旧 `sandbox: "auto"` 的行为),但用户在 review 时明确否掉了这个折中,要求"默认也不允许、按名字选也不允许"两个都去掉(见下)。现在 `resolveSandbox(undefined)` 直接 `throw`,报错文案直接告诉你去 `dockerSandbox()` 等三选一。
3. **CLI `--sandbox <name>` 整个删除**——第一轮曾保留 `--sandbox docker` 当字符串入口、内部转成 spec;第二轮连这个入口也删了。现在传 `--sandbox` 会被 `cli.ts` 里专门 catch 住,打印 `cli.sandboxFlagRemoved`(i18n key)提示去 experiment/config 里写 `sandbox` 字段,exit(1)——不是静默吞掉当未知 flag 处理。

**Why**:用户的原话是"我不想要是 string,我希望只能是类型,这样用户理解简单,然后我们的代码也能少"。第一轮我做了"字段禁字符串,但保留 CLI 字符串入口 + 省略自动探测"的折中,用户看完代码追问"这个 specForBackend 是不是可以迁移了?因为我们不允许默认也不允许用名字呀"——这句话点出我保留的两个隐式路径(默认值、按名字选)本身就是他想去掉的东西,用 `AskUserQuestion` 确认后选的是"两个都要去掉(最彻底)"。

**改動意味着什么**:所有沙箱型 agent 的 experiment,现在**必须**显式写 `sandbox: dockerSandbox()`(或 vercel/e2b),不写就在真正起沙箱那一刻(不是 `--dry`)抛错。`Config.sandbox` 仍然是合法的"项目级兜底"(`exp.sandbox ?? config.sandbox`这条链没变),但链的两端都得是显式 spec,链两端都没设才报错——不是"两端都没设就悄悄挑一个后端"。

**代码结构**:`src/sandbox/resolve.ts` 的 `resolveSandbox()` 收窄成"有 spec 就用,没有就抛" 两行；第一轮加的 `detectBackend()`/`specForBackend()`/`sandboxOptionFromFlag()` 全部删除(死代码,连着 CLI 入口一起没了)。`src/cli.ts` 里 `Flags.sandbox`、`case "sandbox":` 解析分支也删了,换成一个专门的 `case "sandbox": 打印 cli.sandboxFlagRemoved, exit(1)` 防止用户带着旧习惯传 flag 却被静默吞掉、debug 老半天。

**改动范围**:`src/types.ts`(`SandboxBackend`/`SandboxOption`)、`src/sandbox/resolve.ts`(整个简化)、`src/cli.ts`(删 flag + 加拒绝分支)、`src/i18n/{en,zh-CN}.ts`(新增 `sandbox.missingSpec`、`cli.sandboxFlagRemoved`)、`docs/{sandbox,experiments,cli,concepts,README,getting-started}.md`、`docs/adapters/coding-agent-skills-plugins.md`、`docs-site/`(en+zh 若干处,含 `guides/sandbox-backends.mdx` 的 "Auto" tab 需要整段重写——不能只删代码行,`"auto 是大多数团队推荐默认"`这种叙事和 CLI 用法段落都要跟着删)、`examples/zh/coding-agent-skill/experiments/*.ts` 四个文件、以及消费方仓库 `coding-agent-memory-evals` 的六个 `experiments/**/*.ts`。改完用 `pnpm run typecheck` + `niceeval exp compare --dry` + 直接 `import resolve.ts` 单测 `resolveSandbox(undefined)` 确认真的 throw(`--dry` 不会真的起沙箱,不能验证这条路径)。

**踩坑**(第一轮遗留,第二轮已经不需要了但记一笔):想把 CLI 字符串名字转成 spec 时,直接 `{ backend: name }` 强转会被 TS 拒绝——`{backend: SandboxBackend}` 不会自动分发进 `DockerSandboxSpec | VercelSandboxSpec | E2BSandboxSpec | CustomSandboxSpec` 这个可辨识联合,会被整体判定成想匹配 `CustomSandboxSpec` 又缺 `create` 字段。要绕开就得用 switch 按分支调用各家工厂函数,让每个分支的字面量类型精确到位,不需要编译器做联合分发。现在这条路径整个删了,但如果以后又要做"字符串转 spec"这类事,这个坑还在。

关联:[[bub-workspace-path-hardcode]](同一次会话,同一批改动前半段)。
