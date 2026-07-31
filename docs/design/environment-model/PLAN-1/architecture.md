# PLAN-1 Architecture:Environment 与 Provision

**本方案**:[README](README.md) · [Library](library.md) · [Use Case](use-case/README.md)

本篇承接普通用户不需要掌握的解析、身份、能力、准备、生命周期与记录契约。
公开调用形状见 [Library](library.md)。

## 两个内部阶段,不进入普通 API

Runner 把 Eval Environment 与当前 Sandbox Provider 解析成两个内部对象:

```typescript
interface EnvironmentPlan {
  profile: string;
  kind: string;
  environmentKey: string;
  buildKeys: readonly string[];
  capabilities: EnvironmentCapabilities;
  create(): Promise<RunningEnvironment>;
}

interface RunningEnvironment {
  sandbox: Sandbox;
  services?: ServiceController;
  stop(): Promise<void>;
  facts: JsonValue;
}
```

`EnvironmentPlan` 是 Provider-specific 执行计划,`RunningEnvironment` 是已经启动的资源组。
两者都不是 Eval 作者要构造的公开领域对象。

每个 Running Environment 只有一个主 `Sandbox`。
Agent、Fixture、测试命令、文件 API、workdir 与 diff 都锚定它;伴随服务只能通过独立能力句柄访问。

## Environment 解析

Eval 的 `environment` 有三种形状:

| 声明 | 解析 |
|---|---|
| 省略 | 使用 SandboxConfig 的默认起点 |
| profile 字符串 | 查 SandboxConfig 的 `environments` 表 |
| `composeEnvironment(...)` 等 folder-local source | 先查同 profile 的显式 `environments` 覆盖,否则交给 Provider 内建支持 |

folder-local profile 从 Eval 目录路径稳定推导。
显式表项优先,使项目可以在不修改 Eval 的前提下用预制 image、template 或 snapshot 替换按需构建。

内置 Provider 直接声明自己支持的 Environment kind。
Docker 支持 Compose 不需要用户注册 materializer;未来 E2B 或其它 Provider 只有完成 workspace、网络、就绪、采证与清理契约后才能声明相同支持。

缺失分两类:

- profile 不存在或 Environment 声明非法:启动期配置错误,零 Sandbox 创建。
- Environment 合法但当前 Provider 不支持该 kind:计划期 `skipped`;选中集合全部 skipped 时升级为启动期错误。

## 自定义 Provider

自定义 Provider 不再接受用户侧 `materializers` 注册表。
它在自身定义中声明支持的 Environment kind,并负责从 source 产出 Environment Plan:

```typescript
defineSandboxProvider({
  name: "modal",
  environmentKinds: ["compose"],
  async planEnvironment(source, context) {
    return planModalEnvironment(source, context);
  },
  async createDefault(context) {
    return createDefaultModalEnvironment(context);
  },
});
```

支持能力与实现留在同一个 Provider 定义里,不会出现 SandboxConfig 宣称支持、运行时却没有对应实现的分裂配置。
不需要 folder-local Environment 的自定义 Provider 只实现 `createDefault`。

## 身份

### BuildKey

BuildKey 只回答为什么应该得到同一构建产物。
它包含 builder revision、目标平台、Dockerfile、过滤后的 build context、build args 与解析后的基础镜像 digest。

BuildKey 构建在 Attempt 创建 Sandbox 前按 Run 级 single-flight 协调。
同 key 只构建一次,失败只影响依赖该 key 的 Attempt。

### EnvironmentKey

现有 `CaseKey` 改名为 `EnvironmentKey`。
它回答这条 Eval 的完整题目环境是否相同,包含 Environment kind、Provider 解析 revision、全部 BuildKey、镜像 digest、Compose 与 overlay 内容、挂载内容及影响 workspace、网络和就绪的参数。

`EnvironmentKey` 进入每条 Eval 的 fingerprint。
逐 Attempt 容器名、临时目录与随机项目名只作为运行事实,不进入身份。

### Provision identity

Experiment 的有序 `{ name, identity }` 列表进入 `configHash`,并以同一形状落进 `run.json` 与 manifest。
Provision 函数体不哈希;有语义的脚本、payload 与模型输入必须经 digest 或 revision 进入 identity。

完整 Attempt fingerprint 因而由两条正交轴组成:

```text
configHash includes ordered Provision identities
fingerprint includes configHash + Eval source + EnvironmentKey + Eval data
```

更换 image、template 或 snapshot 会改变 EnvironmentKey。
即使 Provision inspect 命中,旧结果也不携带,因为 Provision 不能证明未声明的系统包与运行时配置等价。

## Environment 能力

Provider 在 Environment Plan 上产出统一能力:

```typescript
interface EnvironmentCapabilities {
  platform: string;
  root: "available" | "unavailable" | "unknown";
  network: "direct" | "none" | "unknown";
  services: boolean;
}
```

Provision `platforms` 与目标平台在计划期做交集,确定不相容时 `skipped`。
`installRequirements` 在 inspect miss 后才检查;inspect 命中时不要求安装所需的 root 或 network。
`unknown` 不被当成 available,也不提前阻止执行。

Compose 的明确 `network_mode: none` 解析为 `none`。
未声明网络限制不等于 Provider 已证明外网可用,因此可以保留为 `unknown`;安装时断网按 Provision install 错误归属。

## Provision 协议

单个 Provision 的协议是:

```text
inspect actual identity
  ├─ exact match → hit
  └─ missing or mismatch
       → lazy shared prepare, when declared
       → install
       → inspect actual identity again
```

框架比较 inspection identity 与目标 identity,作者不能只返回一个丢失证据的 boolean。
inspect 必须无副作用;facts 与 detail 只能包含可落盘的非敏感短值。

多个 Provision 按数组顺序执行。
本次只要发生过 install,全部安装结束后再按声明顺序 inspect 全组,避免后一个安装静默破坏前一个目标状态。

Provision 只能写 workdir 之外的 PATH 目录、home、系统路径或受管 cache。
要写入 workdir 的内容属于 Fixture;这条边界避免安装物混入 Agent diff 与复用重置。

## prepare 的节奏

prepare 不能同时做到 Sandbox 创建前决定是否需要和预装命中时完全不运行。
本设计选择按 inspect miss 懒启动,不把这个矛盾藏起来。

single-flight key 是:

```text
Provision name + identity + target platform
```

同平台的多个 Sandbox miss 共享同一份宿主侧 payload;不同平台各自准备。
stageDir 属于本次 Invocation,结束时回收;payload 以路径流式上传,不要求把大文件读进内存。

prepare timing 落 Run 级共享节点,等待它的 Attempt 同时记录 origin。
Sandbox 已经创建并占用资源,所以等待时间继续消耗 Attempt deadline;想彻底移出 Attempt 热路径时使用预制环境。

## 生命周期

setup 侧顺序固定:

| 步骤 | 频次 |
|---|---|
| 解析 Environment、协调 BuildKey | Run 级共享 |
| 创建 Running Environment 并等待 ready | 每 Sandbox |
| Experiment Provision inspect / install / 全组复检 | inspect 每 Attempt,install 仅 miss |
| Adapter 确保 Agent CLI 就位 | 每 Attempt |
| Sandbox 状态 Hook | 每 Sandbox |
| 建立 workdir baseline | 每 Attempt 或复用窗口重置后 |
| Agent setup:鉴权、配置与 MCP 注册 | 每 Attempt |
| Eval setup、Fixture、Agent 执行与评分 | 每 Attempt |

状态 Hook 放在 Provision 与 Agent 安装之后,因此可以使用已经就位的工具。
Agent 的鉴权、配置与 MCP 注册贴着 Attempt 执行,位于状态载入与 workdir baseline 之后。
它不负责安装工具,只负责载入状态、启动日志转发及其它每 Sandbox 副作用。

teardown 侧按对应生命周期逆序收尾:Eval、Agent、Sandbox 状态 Hook、Running Environment stop。
Provision 没有 teardown,安装内容随 Sandbox 销毁。

## Sandbox 复用

`sandboxReuse: true` 继续是 Experiment 的显式语义声明:

- 同一个 EnvironmentKey 分组内才可复用 Sandbox。
- 每条 Attempt 开始前 workdir 回到题间重置点。
- Provision 每 Attempt inspect,miss 才 install。
- `$HOME`、`/tmp`、全局安装、后台进程与外部状态可能存续。
- 复用结果不参与跨 Run 结果携带。

Provision 安装昂贵不自动推出 Sandbox 复用。
默认路径仍是每条 Attempt 取得全新 Sandbox;稳定重依赖进入预制环境,Provider 可以透明克隆准备好的隔离实例。

跨 Attempt 累积状态本来就是实验变量时,作者才开启复用并根据顺序要求设置 `maxConcurrency`。

## 失败与记录

| 失败点 | 结果 | 记录 |
|---|---|---|
| Environment 配置非法 | 启动期错误 | 一次穷举全部配置问题 |
| Provider 不支持 Environment kind | 计划期 `skipped` | Eval、kind、Provider 与可行下一步 |
| Provision 不支持目标平台 | 计划期 `skipped` | Provision、目标平台与支持列表 |
| BuildKey 构建失败 | 依赖 Attempt `errored` | Run 级 build timing origin |
| Running Environment 启动或 ready 失败 | Attempt `errored` | Environment facts、服务状态与日志 |
| Provision prepare 失败 | 等待者 `errored` | Run 级 prepare timing origin |
| Provision install 或复检失败 | Attempt `errored` | Provision name、实际 identity 与候选破坏者 |

逐 Provision activity 使用:

```text
sandbox.provision.<name>.prepare
sandbox.provision.<name>.inspect
sandbox.provision.<name>.install
```

Attempt facts 使用 `provision.<name>.hit` 与 `provision.<name>.<fact>`。
实际 identity、命中情况与逐项耗时使作者能判断哪些 Provision 值得预装。

## 迁移面

| 现有设计 | 新设计 |
|---|---|
| `composeSandbox()` | `composeEnvironment()` |
| `mainService` | `workspaceService` |
| `SandboxSpec` | `SandboxConfig` |
| `defineSandbox()` | `defineSandboxProvider()` |
| `materializers` / `dockerComposeMaterializer()` | 删除;Provider 内建支持 Environment kind |
| sandbox case / `CaseKey` | 内部 Environment Plan / `EnvironmentKey` |
| `defineLayer()` | `defineProvision()` |
| `experiment.layers` | `experiment.provisions` |
| Layer `check` / `apply` | Provision `inspect` / `install` |
| Layer `requires.platform` | Provision `platforms` |
| Layer 安装所需 root / network | Provision `installRequirements` |
| Layer stack / agent Layer | 不进入普通用户术语;Adapter 内部确保 Agent 就位 |
| 安装类 Sandbox Hook | Provision |
| 状态类 Sandbox Hook | 保留 |

niceeval 仍处于 beta,迁移按目标形态一次完成。
Feature 文档、源码、TSDoc、测试与公开站点同批改写,不保留两套别名或兼容分支。
