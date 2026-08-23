# 原生 Agent Plugin

Codex、Claude Code 等 Adapter 已经知道原生 Plugin 的 marketplace、插件名、ref 与安装协议。作者只在 Agent factory 声明一次；Adapter 把它编译成 Agent-owned action，不要求 Experiment 再写一份 clone 或 Sandbox Plugin。

```ts
const agent = codexAgent({
  plugins: [{
    marketplace: {
      name: "nowledge-community",
      source: "nowledge-co/community",
      ref: "main",
      sparse: [".agents", "nowledge-mem-codex-plugin"],
    },
    name: "nowledge-mem",
    install: {
      after: command("python3", ["scripts/install_hooks.py"]),
      changeFrequency: 30,
    },
  }],
  configFile: "configs/codex/nowledge.toml",
});
```

Adapter 将声明编译为同一 occurrence DAG 中的节点：

```text
resolve marketplace ref to exact commit
  → checkout sparse plugin content
  → install marketplace/plugin files
  → run declared installation script
  → write public Agent config
  → inject secret and cohort overlay
  → agent.ensure barrier
  → Agent
```

前四项在输入固定且 Adapter 能验证安装结果时可以进入准备前缀。公开配置文件按原始字节 digest 成为高频 action。API key、远端 Space、cohort、隧道 locator 与当前 Attempt identity 使用私有 callback，始终真实执行，并关闭后续共享 capture。

`ref: "main"` 不是永远复用同一份内容。Adapter 每次 Invocation 先查找它对应的完整 commit；同一 commit 命中，分支推进后自动 miss。显式完整 commit 跳过远端 ref lookup。manifest 同时保存作者 ref 与实得 commit，缓存身份只使用完成态 commit。

## 安装后动作

能由纯命令和固定输入表达的安装后动作放进 Plugin 声明的 `install.after`。它依赖 Adapter 提供的 `agent.plugin-installed:<name>` capability，不靠数组位置猜顺序。作者改变脚本、argv、公开 env 或内容输入时，recipe digest 自动变化。

需要读取 secret、调用远端服务、建立租约或按当前 cohort 写配置的动作继续使用 `postSetup` callback。callback 不伪装成稳定 action，也不能因为函数名相同而命中旧前缀。

```ts
codexAgent({
  plugins: [nowledgePlugin],
  postSetup: [bindCurrentSpace],
  preTeardown: [verifyRemoteStillReachable],
});
```

`bindCurrentSpace` 每条 Attempt 执行；`verifyRemoteStillReachable` 是真实收尾。Plugin clone 和 hooks 安装是否命中缓存，不改变两者的执行次数。

## NiceEval Plugin 只做组合

`definePlugin()` 不新增自己的缓存协议。它的 `sandbox` fragment 返回普通 `SandboxLayer`，由 attachment owner 投影进同一张 action DAG：

```ts
const toolchain = definePlugin<{ archive: URL }>({
  name: "example.toolchain",
  behaviorRevision: "2",
  instanceKey: () => "default",
  sandbox: ({ archive }) => sandboxLayer().before(uploadFile({
    id: "toolchain.archive",
    source: archive,
    to: "/opt/toolchain/toolchain.tar.zst",
    changeFrequency: changeFrequency.rare,
  })),
});
```

Plugin occurrence 保留 name、instanceKey、behaviorRevision、attachment owner 与最终 `attachmentOrdinal`。action 自己保留 recipe、内容 digest、频率与依赖。相同 Plugin definition 挂在 Experiment 和 Eval 上仍是两个 owner occurrence，不能跨 owner 合并身份。

## 不能固定的状态

- Plugin 对远端记忆库的读写；
- Plugin 使用的 API key、Authorization header 与租约；
- 本次 Eval Group 的 Space 或 cohort；
- SessionStart、Stop 等运行期 hook 产生的数据；
- teardown 探活与归档；
- 无法验证 exact provenance 的供应商安装结果。

这些动作可以排在固定安装之后，但不能成为共享前缀。若供应商 CLI 无法证明“当前安装目录正好来自声明的 commit”，Adapter 必须标记 `unsupported` 并真实收敛，不能仅凭目录存在伪造 cache hit。
