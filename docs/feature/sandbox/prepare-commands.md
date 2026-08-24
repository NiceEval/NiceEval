# 内置 before action —— gitCheckout、shell 与命令计划

本页定义最常见昂贵动作的官方写法：`gitCheckout()`、`shell()`，以及 `niceeval debug` 怎样在创建任何 Sandbox 前展示它们的 identity、依赖与缓存资格。

这些内置 action 都实现普通 `SandboxAction` 协议，identity 由纯数据参数构成。Runner 不按 action 名称决定顺序；依赖 DAG 与 `changeFrequency` 统一决定执行位置。

## 不用 before action 安装 Agent CLI

before action 面向题目或实验自己的运行依赖：安装系统工具、检出 fixture、预热数据或写入这次实验的配置。
选择 `codexAgent()`、`claudeCodeAgent()` 等内置 Sandbox Agent 时，CLI 的检查与安装由对应 Adapter 自动完成；作者不需要复制官方安装脚本，也不应把它写进题目 fixture。

Adapter 知道目标 CLI 的精确版本、官方发行物、目标平台与复检方式。这些信息进入 Agent 身份和结果可比性；把安装降成普通 Sandbox action 会丢失该绑定，并让用户手工维护两份版本声明。
需要安装的不是被测 Agent，而是实验自身的工具时，才使用本页的 `shell()` 或第三方 `defineSandboxAction()` family。完整分工见 [Adapter · Agent Ensure](../adapters/architecture/agent-ensure.md)。

## 导出入口

```typescript
import { gitCheckout, shell } from "niceeval/sandbox";
```

## `gitCheckout()`:源码检出

```typescript
interface GitCheckoutActionInput extends SandboxBeforeActionOptions {
  readonly repository: string;
  readonly ref: string;
  readonly to: string;
  readonly sparse?: { readonly include?: readonly string[]; readonly exclude?: readonly string[] };
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
- `ref` 必须是完整 40/64 位 commit object id；V1 不接受 branch、tag、`HEAD` 或默认分支。
- identity 包含规范化 repository、完整 commit、`to`、sparse 选择、action id、频率与祖先前缀。
- 只接受无凭据的公开 HTTPS repository。凭据仓库使用 opaque callback 或受信任系统发布的不可变内容 handle。

调用方若从 branch、tag 或默认分支取得版本，必须先在自己的可信发布流程中查询它当前指向的 commit，并把完整 commit 固定到声明中；移动 ref 不能直接进入可缓存 action。

`gitCheckout()` 装载的是 Agent 应当看见的题目起点。
隐藏判分材料不走它,仍按[本地测试文件](../eval/use-case/criteria-files.md)的规则在 `send` 区间后经普通上传进入。

## 工具安装：一个 `shell()` Action

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "base-node-22" })
    .before(shell({
      id: "install-mempal",
      command: `
        set -eu
        if mempal --version | grep -q '^0.9.0$'; then exit 0; fi
        npm install --global mempal@0.9.0
        mempal --version | grep -q '^0.9.0$'
      `,
      changeFrequency: changeFrequency.rare,
    })),
  agent: codexAgent(),
});
```

语义:

- 整段 script 是一个 `shell()` Action，也就是一个 `sandboxStep.exec()`；它的 command、调度 metadata 与显式 immutable inputs 共同进入自动指纹。
- shell 自己可以使用 `if` 做幂等探测，但 V1 `SandboxStep` tuple 仍是无分支的线性列表。NiceEval 不读取 shell 语法生成另一棵 action DAG，也不为探测分支建立内部 prefix。
- script 的任一非零退出都使整个 action 失败并归入 `sandbox.before.<owner>`；只有整个 script 成功后才允许捕获。
- 普通 shell、网络与时钟读取是否确定由作者承诺。版本、下载内容身份和安装协议必须固定；NiceEval 不对 script 做通用污点证明。
- 需要实例 handle、secret、租约或外部会话时使用普通 callback before，并接受 opaque barrier。

template 预装只是让版本检查首测即成功的一种手段。
声明照常保留；预装缺失或漂移时命令现场补齐，与 [LIMITS「Manifest 不是状态证明」](../../design/environment-model/LIMITS.md)同向。

安装进 workdir 的内容会成为 action artifact 的一部分；restore 后仍存在。Sandbox reuse reset 必须回到包含 physical prefix 的 verified baseline，不能只按旧 workdir 规则猜测安装是否存续。分摊判据见 [沙箱预置放哪](library.md#沙箱预置放哪)。

## 缓存边界

- `gitCheckout()`、`shell()` 与第三方 `defineSandboxAction()` family 是普通 eligible action。hit 恢复 verified private state，miss replay；Provider unsupported 时真实执行。
- command 与普通 JSON/text 输入由作者声明为非敏感和确定性。需要 credential 的安装必须改用 opaque callback，不能把 token 放进 shell command。
- opaque callback 之后的 action 仍可执行，但不能 publish 共享前缀。
- lookup、restore、capture 或 publish 失败时使用统一 `degraded` 路径，从可信短前缀或 Base 最多干净 replay 一次。

## `niceeval debug` 的可证明边界

`niceeval debug <experiment> <eval>` 按配置的每条 Attempt 展示 before。复用 lane 另带每台实际实例各自套用的 physical lifecycle template；每个候选 dispatch slot 都列出自己的 before 与 agent.ensure。debug 不读取 carry 或 cache，固定显示 `cacheLookup: "not-probed"`。

命令工厂把执行闭包已经消费的同一份规范化数据私绑到计划：

- `command(executable, args, { id, ...options })` 精确投影 argv 数组。
- `shell({ id, command, ...options })` 精确投影 command。单行使用 JSON string；多行在 human 的独立区域框内按原始行显示，并保留缩进、空行与末尾换行。
- `shell()` 投影完整 command，但始终是一个 prefix node；script 内的条件与子命令不是嵌套 action。
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
