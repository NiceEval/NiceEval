# 本地执行:localSandbox()

`localSandbox()` 让沙箱型 agent 直接在宿主机的一个本地目录上跑:`workdir` 是宿主机上的真实目录,`runCommand` 在那个目录里起进程,`readText` / `writeText` / `readBytes` / `writeBytes` 是本地文件 IO。
它是 [`Sandbox` 接口](README.md#provider-统一接口)最小的实现——没有远端控制面、没有 provisioning 重试、没有留存注册表,是内置 provider 里最薄的一个。
典型场景:手边就一个 git 仓库要评,不想起 Docker、不想装云 sandbox、也不想为「隔离」付任何代价——让 agent 在这个目录上直接跑一遍,把它改了什么收下来打分。

[`Agent.kind`](../../concepts.md) 只有 `direct` / `sandbox` 两类。
本地执行是 `sandbox` 型的一个 Provider，不是第三类 Agent。
`localSandbox()` 是 template-bearing factory:宿主目录就是它声明的完整起点,同时选定 Local Provider(配对规则见 [Sandbox Layer](layers.md))。
Sandbox Eval 的 `t.sandbox` 面不变，切换 `localSandbox()` / `dockerImageSandbox()` 不需要改 Eval。
核心只对着 `Sandbox` 接口说话，不按 Provider 名分支。

```typescript
import { defineExperiment } from "niceeval";
import { localSandbox } from "niceeval/sandbox";
import { claudeCodeAgent } from "niceeval/adapter";

export default defineExperiment({
  agent: claudeCodeAgent(),
  sandbox: localSandbox(),              // 默认:当前 git 仓库根;agent 就在这里跑
});
```

```typescript
localSandbox({ dir: "/path/to/repo" })  // 或显式指定任意本地目录
```

## 目录定位

- 省略 `dir` 时,从进程当前目录向上定位 git 仓库根作为 `workdir`;不在任何 git 仓库内时直接报错,错误信息给出两条出路:进入目标仓库再跑,或显式传 `dir`。
  不猜、不落到当前工作目录——「评哪个目录」必须是确定的。
- 显式 `dir` 可以是任意本地目录,不要求它已是 git 仓库——变更分类账用自己的私有 GIT_DIR 观察工作树,不依赖目标目录自己的 git(见下节)。
  目录不存在或不可写是确定性错误,创建时第一次如实抛出。

## 只观察,不还原

「把 agent 改了什么收下来」不需要新机制。
[变更分类账](architecture.md#变更归因send-区间与分类账)本来就把自己的 git 目录放在 runner 控制的私有路径、以 workdir 为 work-tree,好让 agent 看不到 runner 的 `.git`。
本地档把这条设计兑现成关键性质:**你仓库自己的 `.git` 是你的,分类账另用一个私有 GIT_DIR(宿主侧 runner 自有路径,不在 workdir 内)观察同一棵工作树**。打 baseline、折 send 区间、出 agent diff 全在私有 GIT_DIR 上完成,你真实的 `.git`、HEAD、暂存区、未提交改动一概不碰(`.git` 本就在[归因排除清单](architecture.md#变更归因send-区间与分类账)里)。

语义因此收敛成四个字:**只观察**。
`t.send()` 让 agent CLI 直接在你的目录里跑,改动真实落在你的工作树上,分类账如实采下 diff 供 `t.sandbox.fileChanged` / `diff` 断言,评分、出报告,结束。
niceeval 不在你的仓库上跑任何 `git reset` / `git clean`——跑完工作树就是 agent 改过的样子,要留要弃是你的事,不是框架替你做的破坏性决定。
这是本地档的正确性中心:**绝不动用户没提交的工作**。
题间“清空 repo 再跑下一题”不属于本地档；Experiment 的 [`sandboxReuse: true`](reuse.md) 与本地档组合时在创建前报错。

只观察的直接推论:一次批跑多条 eval 时,前一条的改动留在工作树上,成为后一条的起点。
本地档天然适合单题、小批的本地迭代;要每题干净起点,用容器 provider。

## 串行独占

同一棵真实工作树不允许两个 attempt 并发写——两个 agent 同时改一个目录,归因和判定都不可信。
这是正确性约束,不是调度偏好:

- local provider 声明**独占串行**(`exclusive`):runner 对声明了 exclusive 的 provider 把 attempt 经 provider 级并发限制强制串行,显式 `--max-concurrency` 或实验级 `maxConcurrency` 都不解除。同批其它 provider 的 attempt 不受影响,照常并发。
  exclusive 是中性的 provider 声明,任何 provider 都可以声明它,核心不出现 `provider == local` 分支。
- local 的推荐并发默认值是 1,照常参与 [Runner](../../runner.md#调度有界并发) 的全局默认值计算。
- 运行反馈如实标注串行事实,让人一眼看出这次没有并发。

## 轻,但仍是显式选择

「轻量」指的是低仪式,不是无声默认。
[Provider 选择](library.md#provider-选择template-带出没有默认值)的硬规矩——沙箱型 agent 的配对没有一方带 template 就报 `sandbox.template-missing`,不自动探测、不静默回退。对本地档同样成立,而且理由更硬:**在宿主机上直接跑 agent 生成的任意 shell 命令是有后果的**(它以你的身份、在你的机器上执行),不能因为「你没配 sandbox」就替你悄悄开一个本地档。

也没有 `--local` 这类运行期替换:provider 选择是 experiment / config 的书面配置,不是运行时参数。
experiment 里写了 `dockerImageSandbox({ image })`、本地想直跑,改的是那一行配置,不是加一个 flag——「在哪跑」直接改变结果的可信度与可比性,把它做成 CLI 开关,签入的实验就失去了「复现时长什么样」的确定性。

本地档买到的低仪式体现在默认值省到极致:`localSandbox()` 不带参数就用当前 git 仓库根,不需要 image / template / snapshot、不需要 prepare 命令装 CLI(你机器上的 agent CLI 直接用)、不需要云凭据。
一行声明就从「配 Docker」变成「就地开跑」;但你仍然显式说了一次「在本地跑」。

## 接口映射与不参与的面

| 面 | 本地档 |
| --- | --- |
| `runCommand` / `runShell` | 在 `workdir` 起宿主进程;语义与其它 provider 一致(argv 不经 shell / 整段交给 shell),`env` 叠加在宿主默认变量之上 |
| `{ user: … }` | 不支持,报错——niceeval 不在你的机器上提权或换身份;需要 root 的 eval 用容器 provider(约定见 [Library · 执行身份](library.md#执行身份)) |
| `stop()` | 只回收 runner 自有资源(私有 GIT_DIR 等),不删除、不还原工作树的任何文件 |
| `otlpHost` | 宿主本机(`localhost`),tracing 直连 |
| 预制实例参数 | 无 `image` / `template` / `snapshotId`——你的机器本身就是 Sandbox |
| [`--keep-sandbox`](cli.md) | 组合在创建前报错:留存的意义是「别销毁」,本地档从不销毁,现场天然留在你的工作树里,无需注册表纳管 |
| [Provisioning 重试](architecture.md#provisioning-失败与重试) | 不参与——创建不经网络控制面,失败(目录不存在、不可写)都是确定性错误,第一次如实抛出 |

## 非目标

- **不新增 `Agent.kind`**:本地执行是 `sandbox` 型的一个 provider,不是第三类 agent。
- **不做隐式本地回退**:没配 sandbox 仍然报错,不因缺配置就悄悄落到本地档。
- **不在本地档做题间 reset**:只观察不还原；题间清空属于 [Sandbox 复用](reuse.md)，它与本地档互斥，组合在创建前报错。
- **不做 `--local` 运行期替换**:provider 选择保持书面配置。
- **不承诺隔离**:本地档明确没有容器的安全 / 可复现 / 并发隔离;要隔离就用容器 provider,这是明码标价的取舍。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Library](library.md) —— 路径与 workdir、执行身份、provider 选择。
- [Architecture](architecture.md) —— 变更分类账、provisioning 重试、留存与注册表。
- [Runner](../../runner.md) —— 有界并发与全局并发上限计算。
