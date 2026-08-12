# 给 Codex 安装 MCP、Skill 与 Hook

## 目标调用点

一个团队维护自己的 Codex capability bundle：随 npm package 发布一份 Skill 与一份 Codex Native Plugin，连接远程 MCP，并同时观察每个 Attempt／逻辑 Send。Experiment 只需要显式选择 Codex，再挂 Plugin：

```ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { codexToolbelt } from "@acme/niceeval-codex-toolbelt";

export default defineExperiment({
  agent: codexAgent(),
  plugins: [
    codexToolbelt({
      mcpUrl: "https://mcp.example.com/v1",
    }),
  ],
});
```

`codexToolbelt()` 扩展这个调用点已选的 Codex；它不能把 Claude／Oracle 换成 Codex，也不能替换 model、provider、主 credential 或 Sandbox template。

## Plugin package 布局

```text
@acme/niceeval-codex-toolbelt/
├── src/index.ts
└── assets/
    ├── review-skill/
    │   └── SKILL.md
    └── codex-plugin/
        └── plugin.json
```

作者用模块相对 URL 声明资产：

```ts
import { definePlugin, pluginAsset } from "niceeval/plugin";

const reviewSkill = pluginAsset(
  new URL("../assets/review-skill", import.meta.url),
);

const codexPlugin = pluginAsset(
  new URL("../assets/codex-plugin", import.meta.url),
);
```

这一步只构造 locator，不读文件。NiceEval 只在 Plugin occurrence 被选中后 snapshot 内容并计算 digest；未选中的 package asset 不产生 I/O。路径中的 symlink、special file 或初始 digest failure 会在创建 Agent 前得到具名失败。V1 materialize 只消费捕获的 snapshot，不重读宿主路径；dry plan 与 Record 不显示宿主绝对路径。

## 组合五类能力

```ts
import {
  agentLifecycleExtension,
  codexNativeExtension,
  credentialFromEnv,
  mcpServersExtension,
  skillsExtension,
} from "niceeval/adapter";
import { shell } from "niceeval/sandbox";

type CodexToolbeltOptions = Readonly<{
  mcpUrl: string;
}>;

const mcpCredential = credentialFromEnv({
  env: "ACME_MCP_TOKEN",
  domain: "com.example.mcp",
  revision: "team-a",
});

export const codexToolbelt = definePlugin<CodexToolbeltOptions>({
  name: "com.acme.codex-toolbelt",
  behaviorRevision: "2",

  experiment(options) {
    return {
      agentExtensions: [
        skillsExtension({
          review: { source: reviewSkill },
        }),

        mcpServersExtension({
          docs: {
            url: options.mcpUrl,
            headers: {
              "X-Client": "niceeval",
            },
            credentialHeaders: {
              Authorization: {
                credential: mcpCredential,
                render: "bearer",
              },
            },
          },
        }),

        codexNativeExtension({
          plugins: {
            "acme-review": {
              source: codexPlugin,
            },
          },
          hooks: acmeCodexNativeHooks,
        }),

        agentLifecycleExtension({
          afterConfigure: [
            shell('python "$HOME/.codex/plugins/acme-review/scripts/install.py"'),
          ],
          beforeAgentTeardown: [
            shell('python "$HOME/.codex/plugins/acme-review/scripts/drain.py"'),
          ],
        }),
      ],

      hostedAgentHooks: {
        beforeAttempt: observeAttemptStart,
        afterAttempt: observeAttemptExit,
        beforeSend: observeLogicalSendStart,
        afterSend: observeLogicalSendExit,
      },
    };
  },
});
```

五类能力各有单一 owner：

| 能力 | 声明 | 执行者 |
|---|---|---|
| Skill | `skillsExtension()` | Codex receiver 安装并收敛。 |
| MCP | `mcpServersExtension()` | Codex receiver 写官方 MCP 配置。 |
| Codex Native Plugin／Hook | `codexNativeExtension()` | Codex receiver 安装，由 Codex runtime 执行。 |
| 安装后／收尾前命令 | `agentLifecycleExtension()` | receiver 分阶段 plan，在 Agent teardown 前完成 drain。 |
| Attempt／逻辑 Send 观测 | `hostedAgentHooks` | NiceEval host 执行。 |

`acmeCodexNativeHooks` 必须是 Codex Adapter 定义的声明式 native-hook 类型，不是 Hosted callback 或 generic config patch。`observeLogicalSendExit` 每次逻辑 `t.send()` 只调用一次；物理 retry 不重复触发，发送失败时收到 `send-failed` 而不是虚构 Turn。

## credential 不进入 Plugin identity

`ACME_MCP_TOKEN` 在 factory、link 和 dry plan 时都不读取。receiver 在写任何 extension 前一次性求值，并将 Bearer 值只送入本 Attempt 的 managed overlay。manifest 可以显示：

```text
docs.Authorization = credential(domain=com.example.mcp, revision=team-a, render=bearer)
```

它不会显示 env selector 或 value。缺少 `env` 键时，materialization error 可以告诉操作者缺少 `ACME_MCP_TOKEN`，但任何 diagnostic、Record、fingerprint 或命令文本都不能带出值。

## 直接配置复用同一 Extension

不需要复用 Plugin family 时，作者可以直接把相同 protocol value 放进 Agent factory：

```ts
const docsMcp = mcpServersExtension({
  docs: { url: "https://mcp.example.com/v1" },
});

export default defineExperiment({
  agent: codexAgent({
    configFile: "configs/codex/base.toml",
    extensions: [docsMcp],
  }),
});
```

Plugin 与直配因此共享相同 validation、merge、manifest、identity 与 cleanup，不存在一套 `mcpServers` factory 字段和另一套 Plugin installer。

## Eval-local 条件

某个 Eval 需要额外 MCP 时，可以把 Plugin 挂在 Eval：

```ts
export default defineEval({
  plugins: [issueTrackerMcp()],
  async test(t) {
    // ...
  },
});
```

这条 extension 只形成该 Eval 的 `PairAgentDelta`。Experiment 的 Run `configHash` 保持不变；pair fingerprint 新增 delta。若 Run plan 已有同名、同 canonical value 的 MCP，只增加 provenance；同名异值在创建 Sandbox 前报 pair link conflict。

Sandbox reuse 时，下一 Eval 没挂 `issueTrackerMcp()` 也不会继承它。receiver 用本次完整 desired state 移除上一 Attempt 的 NiceEval-managed MCP 配置；它不删除未知用户文件或 Plugin 写在 managed overlay 外的运行数据。

## 跨 Agent bundle

只支持 Codex 的 Plugin 挂到 Claude 时，link 会列出 `codexNativeExtension` 不受 selected receiver 支持，而不是启动后才失败。真正需要同时支持两者时，显式声明供应商替代实现：

```ts
import {
  claudeCodeNativeExtension,
  oneOfAgentExtensions,
} from "niceeval/adapter";

oneOfAgentExtensions(
  codexNativeExtension({ plugins: { memory: codexMemoryPlugin } }),
  claudeCodeNativeExtension({ plugins: { memory: claudeMemoryPlugin } }),
);
```

shared Skill／MCP 仍各声明一次。choice 只按 protocol token 的静态 support 选中一个 branch；选中后的 payload 或冲突失败不会偷偷回退另一 branch。

## Dry plan 应能回答的问题

```bash
pnpm exec niceeval exp compare/codex-toolbelt --dry --commands
```

无需创建 Sandbox，操作者就应看到：

1. `com.acme.codex-toolbelt@default` 挂在 Experiment；
2. Skill、MCP、Codex Native Plugin 与 lifecycle command 各由哪个 receiver 接受；
3. local asset 的 kind／digest 与 remote source 的 immutable identity；
4. Hosted Hook 与 Agent 原生 Hook 的不同执行者和确定顺序；
5. Run projection 与 pair delta 分别进入哪个 identity；
6. 同值去重的全部 provenance，或异值 conflict 的双方 provenance；
7. 不支持／choice ambiguity／reuse unsupported 的具体原因；
8. redacted credential domain／revision／render，不出现 env selector、value 或宿主绝对路径。
