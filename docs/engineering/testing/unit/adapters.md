# Adapters 怎么测（Agent Ensure 与确定性 Adapter 逻辑）

契约来源：

- [Adapters](../../../feature/adapters/README.md)
- [Agent Ensure](../../../feature/adapters/architecture/agent-ensure.md)
- [会话与 HITL 状态模型](../../../feature/adapters/architecture/session-state.md)
- [Sandbox Agent](../../../feature/adapters/library/sandbox-agent.md)
- [Sandbox Case](../../../feature/sandbox/case.md)
- [Experiments · 缓存与携带](../../../feature/experiments/cache.md)

本篇覆盖 Adapter 侧**确定性**契约：Agent ensure 循环、身份与 staged payload digest、断网题面义务、与 Sandbox 复用 / environment 的隔离。
SDK 事件转换与协议归一没有单元层测试维度——协议的真身只有真实调用，验收面是 [E2E 适配器域](../e2e/adapter/README.md)。
归一之后与协议无关的派生（成本估算、执行树投影）登记在 [reports.md](reports.md) / [record.md](record.md)。

## 观察面与边界

| 契约域 | 观察面 | Fixture |
| --- | --- | --- |
| ensure 循环 | 探测 / install / 复检的调用序、安装事实、失败归属 | recording Sandbox + 脚本化安装层 |
| 身份与 staged payload | fingerprint / configHash 输入、Run 投影字段 | 纯数据 identity + digest fixture |
| 断网题面 | 题面网络配置在 Ensure 前后逐字相等；安装是否走文件 API | 带故障 DNS / 被替换工具的 recording Sandbox |
| 复用与环境隔离 | 第二次 check 命中、跨 profile 不串装 | 复用同一 Sandbox 的多 attempt；两 profile 并列 |
| typed session slot | symbol 身份、值类型、一次消费与会话线隔离 | 两个同名 slot；两条独立 AgentSession |

缝：fake 自有 `Sandbox` 接口与脚本化 `AgentInstaller`，测 ensure 循环与身份逻辑；缝的真实侧（真实 Agent CLI 安装）由 E2E 适配器域验收。
Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## Fixture 规范

ensure 测试不连真实包管理器或 registry。
探测 的命中与未命中由 Sandbox fixture 按脚本返回退出码；安装层 fixture 记录 install 调用，按脚本成功或抛错。
Sandbox fixture 记录 `runCommand` / 文件 API，默认 stub 对意外调用抛错（规则见 [Harness](harness.md)）。

```ts
function scriptedInstaller(steps: {
  install?: () => Promise<void>;
}): AgentInstallerFixture {
  const installs: unknown[] = [];
  return {
    identity: { agent: "fixture", version: "1.0.0" },
    installMode: "staged",
    async install(sandbox) {
      installs.push(sandbox.sandboxId);
      if (steps.install === undefined) throw new Error("unexpected install");
      await steps.install();
    },
    installs,
  };
}
```

身份与指纹类测试构造纯数据 identity / artifact digest，不复制指纹算法；期望值写在 case 里。
断网类 fixture 必须让「改了题面网络」与「只经文件 API 安装」在观察面上可区分——否则删掉 staged 路径的负面格没有区分力。

## 覆盖规范

- **Agent 构造入口**（[Adapter Library](../../../feature/adapters/library.md)）：

  - `defineAgent` 固定产出 `kind: "direct"`，并保留 Direct Agent 的公开定义字段。
  - `defineDirectAgent` 是指向 `defineAgent` 的 deprecated 兼容 alias，不建立第二套构造逻辑。
  - 动态 JavaScript 输入违反必填契约时，错误统一指向 canonical `defineAgent`。
- **原始工具名与规范分类**（[标准事件模型](../../../feature/adapters/architecture/events.md)）：
  - 上游提供的工具名在 `StreamEvent.operation.name` 原样保存；归一函数只计算旁边的 `tool: ToolName`，不能改写原名。
  - 通用复合别名按大小写无关规则映射为 `ToolName`；进入规范化流程后仍不认识时保留原始 `name`，并把 `tool` 分类为 `unknown`。
    不承诺分类任意应用工具的协议可以省略 `tool`，但仍必须保留原始 `name`。
  - `search`、`run` 等可能属于被测应用的单字动词不能由通用表猜成系统工具。
  - Unit 只展开这张 NiceEval 自有的确定性基表。某个 SDK / CLI 是否同时写入正确原始名与规范分类，
    仍由对应 Adapter E2E 证明，不在这里复制上游 wire fixture。
- **探测 命中、staged 安装、复检失败**（[Agent Ensure](../../../feature/adapters/architecture/agent-ensure.md)）：

  - 探测 命中 → 记录命中的安装事实，不调用 install。
  - 探测 未命中 → 按 identity 配对安装层 install → 同一个 探测 复检；全部经主 Sandbox 的命令与文件 API。
  - 安装退出 0、复检仍未命中 → `agent.ensure` `errored`，附期望版本与下一步，不记成做题 `failed`。
  - 探测 未命中且无 identity 匹配的安装层 → `agent.ensure` `errored`，错误信息给出预制环境与 `installTool` 两条出路。
  - 不按 template 名短路；三种安装模式失败后不静默降级到另一种。
  - `installMode: "verify-only"` 的 探测 未命中立即 `errored`，不联网、不改文件系统。
- **Agent identity / artifact identity**：

  - `identity`（Agent 名、精确版本）与配对安装层 identity、staged payload digest / 平台正交进入指纹与 `run.json`。
  - 改 Agent 版本改变 ensure identity 与 `agent.artifact.prepare`，不重建任务 BuildKey。
  - 改任务 Dockerfile 只重建环境，不动 Agent 配置。
  - 无精确版本的 `latest` 安装不参与可携带结果；ensure 声明无法给出稳定 identity 时启动期报错。
  - 实际版本落 attempt facts，不能反过来替代规划期指纹。
- **命令证据敏感值 provenance**：官方 Adapter 把已知凭据同步登记到 `CommandOptions.sensitiveValues`。
  覆盖 MCP HTTP header、stdio env、Hermes/OpenClaw 配置，以及模型 CLI 运行环境里的 API key。
  fixture 同时断言原执行脚本含合成值、同一次调用 options 登记该值；manifest 仍不得包含这些字段。
- **官方 Agent 进程环境**：factory 声明的额外环境只经 Sandbox 命令 options 注入，不拼进 shell 文本。
  Codex 首轮 `exec` 与后续 `exec resume` 必须取得同一份声明；CLI 启动的 lifecycle Hook 与子进程因此继承同一环境。
  所有声明值按潜在敏感值登记，避免命令输出或失败证据把它们带进 timing、execution 与错误记录。
  `env` 里出现 `PATH` 键在 `codexAgent()` 调用时同步报错（不留到 `setup()` 才炸），错误指向 Sandbox factory 的 `pathPrepend`（见 [sandbox.md](sandbox.md)「PATH 与 pathPrepend」）。
- **断网题不改网络**：

  - 故障 DNS / `extra_hosts` / 被替换工具在 ensure 循环前后逐字保持。
  - 默认 staged 路径经宿主准备 + 主 Sandbox 文件 API 安装，不依赖也不修复题面网络。
  - 删除 staged 路径后同类题必须失败在 `agent.ensure`——这是与「静默改网络再装」的区分力。
- **Sandbox 复用命中与 environment 隔离**：

  - 同一 Sandbox 复用时，第一次安装后后续 attempt 的 探测 快速命中。
  - 安装产物在 workdir 外的 Agent 自有目录，题间 reset 不删除。
  - 不同 environment profile 不共享 Sandbox，也不共享安装产物。
  - 一条重环境 eval 装过的 Agent 不得让另一条环境错误继承；安装事实与指纹不串组。
- **Typed SessionSlot**（[会话与 HITL 状态模型](../../../feature/adapters/architecture/session-state.md)）：

  - `createSessionSlot<T>()` 保留值类型；错类型 `set` 与把 `get` 结果当成其它 slot 类型均不能编译。
  - 新会话线的 `get` / `take` 为空；`set` 后 `get` 可重复读，`take` 返回同一值并立即删除。
  - 同名 slot 仍按 symbol 身份隔离；不同 `AgentSession` 之间不共享 slot 值。
  - 公开 `AgentSession` 不存在字符串 `state` 字典，也不存在无 slot 的 `history` / `hold` / `take`。

## 不这样测

- 不 fake 第三方包管理器、registry HTTP 或真实 Agent CLI 的 wire 协议；真实安装归 E2E。
- 不按 template 名或 image tag 断言「已预装」来跳过 探测——预装只是 探测 命中优化。
- 不把 BuildKey / CaseKey 的环境身份测试复述进本篇；环境身份归 [sandbox.md](sandbox.md)，这里只证与 Agent identity 的正交。
- 不允许没写实现体的 Sandbox / 安装层 stub 静默返回成功。
