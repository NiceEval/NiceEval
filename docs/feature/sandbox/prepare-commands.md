# 内置 before action —— gitCheckout、installTool 与命令计划

本页定义最常见昂贵动作的官方写法：`gitCheckout()`、`installTool()`，以及 `niceeval debug` 怎样在创建任何 Sandbox 前展示它们的 identity、依赖与缓存资格。

两条内置 action 都实现普通 `SandboxAction` 协议，identity 由纯数据参数构成。Runner 不按 action 名称决定顺序；依赖 DAG 与 `changeFrequency` 统一决定执行位置。

## 不用 `prepare()` 安装 Agent CLI

`prepare()` 面向题目或实验自己的运行依赖：安装系统工具、检出 fixture、预热数据或写入这次实验的配置。
选择 `codexAgent()`、`claudeCodeAgent()` 等内置 Sandbox Agent 时，CLI 的检查与安装由对应 Adapter 自动完成；作者不需要复制官方安装脚本，也不应把它写进题目 fixture。

Adapter 知道目标 CLI 的精确版本、官方发行物、目标平台与复检方式。这些信息进入 Agent 身份和结果可比性；把安装降成普通 prepare 命令会丢失该绑定，并让用户手工维护两份版本声明。
需要安装的不是被测 Agent，而是实验自身的工具时，才使用本页的 `installTool()`。完整分工见 [Adapter · Agent Ensure](../adapters/architecture/agent-ensure.md)。

## 导出入口

```typescript
import { gitCheckout, installTool } from "niceeval/sandbox";
```

## `gitCheckout()`:源码检出

```typescript
interface GitCheckoutActionInput {
  readonly id: string;
  readonly repository: string;
  readonly ref: string;
  readonly to: string;
  readonly sparse?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
  readonly changeFrequency?: number;
}

declare function gitCheckout(options: GitCheckoutActionInput): SandboxAction;
```

```typescript
export default defineEval({
  sandbox: sandboxLayer()
    .before(gitCheckout({
      id: "fixture-repo",
      repository: "https://github.com/acme/fixture-repo.git",
      ref: "9e107d9d4f6a6af8f1d53d4dc37b22d7d98c23af",
      to: ".",
      changeFrequency: changeFrequency.rare,
    })),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

语义:

- 目标目录得到 HEAD 指向完成态 commit 的 Git checkout；`to` 是 workdir 相对路径。
- NiceEval 在本次 Invocation 内查找 ref 对应的完整 commit，并冻结查找结果。相同 commit 命中相同前缀；ref 推进后自动 miss。
- identity 包含规范化 repository、完整 commit、`to`、sparse 选择、action id、频率与祖先前缀。
- 只接受无凭据的公开 HTTPS repository。凭据仓库使用 opaque callback 或受信任系统发布的不可变内容 handle。

完整 commit 跳过远端 ref lookup。branch、tag 与默认分支可以移动，但不会把新 commit 错当成旧缓存。

`gitCheckout()` 装载的是 Agent 应当看见的题目起点。
隐藏判分材料不走它,仍按[本地测试文件](../eval/use-case/criteria-files.md)的规则在 `send` 区间后经普通上传进入。

## `installTool()`:探测、安装与复检

```typescript
interface InstallToolOptions {
  readonly tool: string;
  readonly identity: SandboxCommandIdentityValue;
  readonly probe: StableSandboxCommand;
  readonly install: StableSandboxCommand;
}

declare function installTool(options: InstallToolOptions): StableSandboxCommand;
```

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "base-node-22" })
    .before(installTool({
      tool: "mempal",
      identity: { version: "0.9.0" },
      probe: shell("mempal --version | grep -q 0.9.0"),
      install: shell("curl -fsSL https://get.mempal.dev | sh"),
    })),
  agent: codexAgent(),
});
```

语义:

- `probe` 以 try 语义执行:退出码为零即命中,命令立即返回;非零是未命中,不是失败。
- 未命中时执行 `install`,随后重跑 `probe` 复检;install 失败或复检仍非零,按执行失败计,归 `sandbox.prepare.<owner>`。
- identity 是 `tool` 加 `identity` 参数,并折入 `probe` 与 `install` 的 command identity;任一项变化使旧命中失效。
- `probe` 与 `install` 必须是稳定 command(`command()` / `shell()` 或 `defineSandboxCommand()` 返回的定义值)。
  opaque callback 不能作为 `installTool` 参数，需要不透明逻辑时使用普通 `prepare()` callback，其结果仍按默认规则携带。

template 预装只是让 `probe` 首测即命中的一种手段。
声明照常保留;预装缺失或漂移时命令现场补齐,与 [LIMITS「Manifest 不是状态证明」](../../design/environment-model/LIMITS.md)同向。

安装进 workdir 的内容在复用 reset 后会消失并触发重装;要享受周期内命中,安装目标应在 workdir 外(`$HOME`、`/usr/local`)。
分摊判据见 [沙箱预置放哪](library.md#沙箱预置放哪)。

## 缓存边界

- 镜像与探测不共享任何跨 Sandbox 的状态;缓存活在当前 Sandbox 的 workdir 外私有路径,随 Sandbox 销毁消失。
- 缓存不经 `context.onCleanup()` 登记——它的价值正是跨 Attempt 存续;需要销毁整窗状态时退休或停止 Sandbox。
- 缓存服从 reset 与活状态边界:reset 只恢复 workdir,不触碰镜像;Sandbox lifecycle hook 拥有的路径内置命令不写入。
- 缓存不可用或损坏时按首次执行处理(重新走网络或重装),不产生额外错误类别。

## `niceeval debug` 的可证明边界

`niceeval debug <experiment> <eval>` 按配置的每条 Attempt 展示 prepare。复用 lane 另带每台实际实例各自套用的 physical lifecycle template；每个候选 dispatch slot 都列出自己的 prepare 与 agent.ensure。debug 不读取 carry 计划，正常运行仍可能沿用结果而不派发这些 slot。

命令工厂把执行闭包已经消费的同一份规范化数据私绑到计划：

- `command(executable, args, options)` 精确投影 argv 数组。
- `shell(script, options)` 精确投影 script。单行使用 JSON string；多行在 human 的独立区域框内按原始行显示，并保留缩进、空行与末尾换行。JSON 计划仍保存原始 script string。
- `installTool()` 投影完整条件树：先运行 `probe` 探测命令；探测未命中才 install，再用同一命令 recheck。子命令若由 `command()` / `shell()` 创建就是 exact；普通 `defineSandboxCommand()` 虽然有稳定 fingerprint identity，仍是 opaque。
- `gitCheckout()` 显示 repository、作者 ref、完成态 commit、sparse 选择、目标、频率、依赖、缓存资格与 prefix identity。
- 普通 `.before(async (sandbox) => …)` 与 `defineSandboxCommand(identity, run)` 的 `run` 都标为 opaque。公开 identity 可由作者自行命名，不能拿 id / inputs 猜它会执行什么。

`cwd`、`user`、`timeoutMs` 与 env key 可以展示；env value 与 stdin 只记 redaction，不进入 human / JSON 命令计划。argv 与 shell script 本身会原样进入计划，因此不得直接嵌 token、密码或私有正文；用 env、credential provider 或受管内容通道传递秘密。

这个输出回答“按当前静态计划，哪些命令分支可能位于哪里”，不预测探测命令是否命中、不运行 callback，也不是成本估算器。实际分支与命令结果仍由运行后的 execution 证据回答。

## 不做什么

- 不新增执行频次、window scope 或按配对的替换表;内置命令在两层 layer 的既有位置执行。
- Agent 前 fixture 使用 `uploadFile()` / `uploadDirectory()` action；隐藏判据使用 `sandboxContent.*()` 登记，在 `test(t)` 中传入。
- 不提供 `t.sandbox.cloneRepo` 一类 test 期装载 API；`gitCheckout()` 是 before action。
- Provider 不支持跨 Invocation 前缀时降级为 invocation-local 或真实 replay，不能伪造 hit。

## 相关阅读

- [Sandbox Layer](layers.md) —— before action、command identity 与 opaque 规则。
- [三方准备时序](lifecycle.md) —— occurrence、缓存满足与错误归属。
- [Sandbox 复用](reuse.md) —— reset、复用池键与污染诊断。
- [选型存档](../../design/prepare-commands/DECISION.md) —— 为什么是官方内置命令而不是意图分类或纯惯用法。
