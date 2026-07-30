# Adapters 怎么测（Agent Ensure 与确定性 Adapter 逻辑）

契约来源：

- [Adapters](../../../feature/adapters/README.md)
- [Agent Ensure](../../../feature/adapters/architecture/agent-ensure.md)
- [Sandbox Agent](../../../feature/adapters/library/sandbox-agent.md)
- [Sandbox Case](../../../feature/sandbox/case.md)
- [Experiments · 缓存与携带](../../../feature/experiments/cache.md)

本篇覆盖 Adapter 侧**确定性**契约：Agent Ensure 状态机、身份与制品 digest、断网题面义务、与 Sandbox 复用 / environment 的隔离。
SDK 事件转换与协议归一没有单元层测试维度——协议的真身只有真实调用，验收面是 [E2E 适配器域](../e2e/adapter/README.md)。
归一之后与协议无关的派生（成本估算、执行树投影）登记在 [reports.md](reports.md) / [record.md](record.md)。

## 观察面与边界

| 契约域 | 观察面 | Fixture |
| --- | --- | --- |
| Ensure 状态机 | check / install / recheck 调用序、安装事实、失败归属 | recording Sandbox + 脚本化 provisioner |
| 身份与制品 | fingerprint / configHash 输入、Run 投影字段 | 纯数据 identity + digest fixture |
| 断网题面 | 题面网络配置在 Ensure 前后逐字相等；安装是否走文件 API | 带故障 DNS / 被替换工具的 recording Sandbox |
| 复用与环境隔离 | 第二次 check 命中、跨 profile 不串装 | 复用同一 Sandbox 的多 attempt；两 profile 并列 |

缝：fake 自有 `Sandbox` 接口与脚本化 `AgentProvisioner`，测 Ensure 与身份逻辑；缝的真实侧（真实 Agent CLI 安装）由 E2E 适配器域验收。
Fake 规则见[单元测试边界](README.md#fake-边界mock-什么测哪一层)。

## Fixture 规范

Ensure 测试不连真实包管理器或 registry。
provisioner fixture 记录 check / install 调用，按脚本返回命中或失败；Sandbox fixture 记录 `runCommand` / 文件 API，默认 stub 对意外调用抛错（规则见 [Harness](harness.md)）。

```ts
function scriptedProvisioner(steps: {
  check: readonly AgentCheckResult[];
  install?: () => Promise<void>;
}): AgentProvisionerFixture {
  const checks: unknown[] = [];
  return {
    identity: { agent: "fixture", version: "1.0.0", revision: "r1" },
    async check(sandbox) {
      checks.push(sandbox.sandboxId);
      const hit = steps.check[checks.length - 1];
      if (hit === undefined) throw new Error("unexpected check");
      return hit;
    },
    async install(sandbox) {
      if (steps.install === undefined) throw new Error("unexpected install");
      await steps.install();
    },
    checks,
  };
}
```

身份与指纹类测试构造纯数据 identity / artifact digest，不复制指纹算法；期望值写在 case 里。
断网类 fixture 必须让「改了题面网络」与「只经文件 API 安装」在观察面上可区分——否则删掉 staged 路径的负面格没有区分力。

## 覆盖规范

- **Ensure 检查命中、staged 安装、复检失败**（[Agent Ensure](../../../feature/adapters/architecture/agent-ensure.md)）：

  - 检查通过 → 记录检查命中的安装事实，不调用 install。
  - 检查失败 → install → 同一个 check 复检；全部经主 Sandbox 的命令与文件 API。
  - 安装退出 0、复检仍失败 → `agent.setup` `errored`，附期望 / 实际版本与下一步，不记成做题 `failed`。
  - 不按 template 名短路；三种安装模式失败后不静默降级到另一种。
  - `verifyOnly` 检查失败立即 `errored`，不联网、不改文件系统。
- **Agent identity / artifact identity**：

  - `identity`（名、精确版本、配方修订）与制品 digest / 平台正交进入指纹与 `run.json`。
  - 改 Agent 版本改变 Ensure identity 与 `agent.artifact.prepare`，不重建任务 BuildKey。
  - 改任务 Dockerfile 只重建环境，不动 Agent 配置。
  - 无精确版本的 `latest` 安装不参与可携带结果；自定义 provisioner 无稳定身份时启动期报错。
  - 实际版本落 attempt facts，不能反过来替代规划期指纹。
- **断网题不改网络**：

  - 故障 DNS / `extra_hosts` / 被替换工具在 Ensure 前后逐字保持。
  - 默认 staged 路径经宿主准备 + 主 Sandbox 文件 API 安装，不依赖也不修复题面网络。
  - 删除 staged 路径后同类题必须失败在 `agent.setup`——这是与「静默改网络再装」的区分力。
- **Sandbox 复用命中与 environment 隔离**：

  - 同一 Sandbox 复用时，第一次安装后后续 attempt 的 check 快速命中。
  - 安装产物在 workdir 外的 Agent 自有目录，题间 reset 不删除。
  - 不同 environment profile 不共享 Sandbox，也不共享安装产物。
  - 一条重环境 eval 装过的 Agent 不得让另一条环境错误继承；安装事实与指纹不串组。

## 不这样测

- 不 fake 第三方包管理器、registry HTTP 或真实 Agent CLI 的 wire 协议；真实安装归 E2E。
- 不按 template 名或 image tag 断言「已预装」来跳过 check——预装只是检查命中优化。
- 不把 BuildKey / CaseKey 的环境身份测试复述进本篇；环境身份归 [sandbox.md](sandbox.md)，这里只证与 Agent identity 的正交。
- 不允许没写实现体的 Sandbox / provisioner stub 静默返回成功。
