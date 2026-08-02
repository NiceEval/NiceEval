# 内置 prepare 命令 —— checkout、installTool 与计划面成本

`prepare()` 命令每条 Attempt 都重放,昂贵动作靠真实检查快速命中;这条 cadence 由[三方准备时序](lifecycle.md)固定。
本页定义两件事:最常见昂贵动作的官方写法(`checkout()` 与 `installTool()`),以及 `--dry` 怎样在创建任何 Sandbox 前展示复用的成本分摊。

两条内置命令都是 `defineSandboxCommand()` 的封装:检查、缺失时执行、执行后复检一次成型,identity 由纯数据参数构成。
Runner 与 [SandboxLayer](layers.md) 协议不含任何内置命令专属分支;对框架而言它们就是带稳定 identity 的普通 prepare 命令。

## 导出入口

```typescript
import { checkout, installTool } from "niceeval/sandbox";
```

## `checkout()`:源码检出与镜像缓存

```typescript
interface CheckoutOptions {
  readonly repo: string;
  readonly ref: string;
  readonly into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

```typescript
export default defineEval({
  sandbox: sandboxLayer()
    .prepare(checkout({
      repo: "https://github.com/acme/fixture-repo",
      ref: "9e107d9d",
    })),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

语义:

- 目标目录得到 HEAD 指向 `ref` 的 git 检出;`into` 是 workdir 相对路径,省略时检出到 workdir 根。
- 命令在 workdir 外维护按 `(repo, ref)` 键控的镜像。首条 Attempt 走网络,同一 Sandbox 的后续 Attempt 从镜像写入 workdir,零网络。
- identity 是 `(repo, ref, into)`，进入 Attempt fingerprint 与命令自己的检查标记；它不进入物理复用池键，因为命令在每条 Attempt 都会重放。换 `ref` 会让旧结果不能携带，并使旧检查标记失效。
- 凭据走宿主与 Sandbox 的 git 原生机制,不进入 identity,也不落运行记录。

`ref` 应当是不可变引用(commit SHA 或 tag)。
首次执行把解析出的 commit SHA 记进运行事实;`ref` 不是该 SHA 本身时,当前 Attempt 不参与跨 Run 结果沿用——与[浮动 image tag 的规则](case.md#buildkey-与-casekey两个身份各管一件事)同理,复用窗口内的镜像命中不受影响。

`checkout()` 装载的是 Agent 应当看见的题目起点。
隐藏判分材料不走它,仍按[本地测试文件](../eval/use-case/criteria-files.md)的规则在 `send` 窗口后经普通上传进入。

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
    .prepare(installTool({
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
- `probe` 与 `install` 必须是稳定 command(`command()` / `shell()` 或 `defineSandboxCommand()` 产物);传入 opaque callback 会让整条 installTool opaque,禁跨 Run carry。

template 预装只是让 `probe` 首测即命中的一种手段。
声明照常保留;预装缺失或漂移时命令现场补齐,与 [LIMITS「Manifest 不是状态证明」](../../design/environment-model/LIMITS.md)同向。

安装进 workdir 的内容在复用 reset 后会消失并触发重装;要享受窗口内命中,安装目标应在 workdir 外(`$HOME`、`/usr/local`)。
分摊判据见 [环境预置放哪](library.md#环境预置放哪)。

## 缓存边界

- 镜像与探测不共享任何跨 Sandbox 的状态;缓存活在当前 Sandbox 的 workdir 外私有路径,随 Sandbox 销毁消失。
- 缓存不经 `context.onCleanup()` 登记——它的价值正是跨 Attempt 存续;需要销毁整窗状态时退休或停止 Sandbox。
- 缓存服从 reset 与活状态边界:reset 只恢复 workdir,不触碰镜像;Sandbox lifecycle hook 或 State Feature 拥有的路径内置命令不写入。
- 缓存不可用或损坏时按首次执行处理(重新走网络或重装),不产生额外错误类别。

## `--dry` 复用成本视图

对声明 `sandboxReuse: true` 的 Experiment,`--dry` 逐命令展示成本类别与依据,不创建任何 Sandbox:

| 类别 | 判定 | 含义 |
|---|---|---|
| 检查命中型 | 内置命令自己声明 | 首条 Attempt 全额执行;窗口内后续 Attempt 预计只付一次探测或本地写入 |
| 每题重放 | 其余全部命令 | 每条 Attempt 全额执行,包括作者自写的 `defineSandboxCommand()` 封装 |

类别是声明,不是运行结果;命中与否始终由运行时探测决定,视图只回答「复用预计省什么」。
fresh 模式的 `--dry` 不展示该视图,因为每条 Attempt 都是首次执行。

## 不做什么

- 不新增执行频次、window scope 或按配对的覆盖表;内置命令在两层 layer 的既有位置执行。
- fixture 物料沿用 `registerSandboxContent()` / `putContent()` 与 `test(t)` 普通上传,不建平行 API。
- 不提供 `t.sandbox.cloneRepo` 一类 test 期装载 API;`checkout()` 是 prepare 相位的 layer 命令。
- 不做跨 Provider 的窗口内快照或恢复原语;成本分摊面由 workdir reset 这一唯一恢复原语决定。

## 相关阅读

- [Sandbox Layer](layers.md) —— `prepare()`、command identity 与 opaque 规则。
- [三方准备时序](lifecycle.md) —— 每 Attempt 重放的 cadence 与错误归属。
- [Sandbox 复用](reuse.md) —— reset、复用池键与污染诊断。
- [选型记录](../../design/prepare-commands/DECISION.md) —— 为什么是官方内置命令而不是意图分类或纯惯用法。
