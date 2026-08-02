# Terminal-Bench:导入 task package,Experiment setup

契约单源见 [Library · 数据集 adapter 派生 Environment](../library.md#数据集-adapter-派生-environment)与 [Architecture · 固定 setup 层次](../architecture.md#固定-setup-层次)。

## 事实边界

本例核对自 [harbor-framework/terminal-bench](https://github.com/harbor-framework/terminal-bench) 的 `d28711d0da2675d0bb1d56de45ae5df6082438a3`,不以迁移后的 NiceEval 仓库反推需求。

上游把 benchmark 分成 task dataset 与 execution harness。
每个 `original-tasks/<id>/` 目录本身就是完整 task package:

```text
<id>/
├── task.yaml
├── docker-compose.yaml
├── Dockerfile 与其它 build inputs
├── run-tests.sh
├── tests/
└── solution.sh 或 solution.yaml
```

上游 harness 固定从 task 目录取得 `docker-compose.yaml`,build/up 后进入 `client` 容器运行 Agent。
Agent 结束后,harness 才把 `run-tests.sh` 与 `tests/**` 复制到 `/tests` 并判分。

所以环境的真正 owner 是 task package。
NiceEval 迁移 adapter 只负责翻译这个格式;迁移者不应给数百道题重新手写一份 `environment:`。

## 文件布局

原始 task dataset 保持上游结构,一份 `.eval.ts` 负责整批导入:

```text
vendor/terminal-bench/
└── original-tasks/
    ├── path-tracing/...
    ├── model-extraction-relu-logits/...
    └── ...
evals/
├── _lib/terminal-bench.ts
└── terminal-bench.eval.ts
experiments/
├── terminal-bench-codex.ts
└── terminal-bench-codex-mempal.ts
```

dataset mirror 可以由版本锁或导入工具更新。
NiceEval 不要求修改每个上游 task,也不在 task 目录中混入 wrapper 文件。

## 单一导入入口

```typescript
// evals/terminal-bench.eval.ts
import { loadTerminalBench } from "./_lib/terminal-bench.ts";

export default await loadTerminalBench({
  root: new URL("../vendor/terminal-bench/original-tasks/", import.meta.url),
  revision: "d28711d0da2675d0bb1d56de45ae5df6082438a3",
});
```

`loadTerminalBench()` 返回 `Record<string, EvalDef>`。
record key 是上游 task id,最终 Eval id 为 `terminal-bench/<task-id>`。

它内部对每个目录做固定投影:

```typescript
import { z } from "zod";

const TaskYaml = z.object({
  instruction: z.string(),
  tags: z.array(z.string()).optional(),
  max_agent_timeout_sec: z.number(),
  max_test_timeout_sec: z.number(),
});

export async function loadTerminalBench(options: Options) {
  return mapTaskDirectories(options.root, async (taskId, root) => {
    const task = await loadYaml(new URL("task.yaml", root), (value) => TaskYaml.parse(value));

    return defineEval({
      description: `Terminal-Bench: ${taskId}`,
      tags: ["terminal-bench", ...(task.tags ?? [])],
      environment: terminalBenchTaskEnvironment({
        compose: new URL("docker-compose.yaml", root),
        mainService: "client",
        revision: options.revision,
        private: ["solution.sh", "solution.yaml"],
        hidden: ["run-tests.sh", "tests/**"],
      }),
      timeoutMs:
        (task.max_agent_timeout_sec + task.max_test_timeout_sec) * 1_000,
      metadata: { benchmark: "terminal-bench", task: taskId },
      async test(t) {
        await t.send(task.instruction);
        await t.verifier.using(
          terminalBenchVerifier(root, task.max_test_timeout_sec),
          async ({ sandbox }) => {
            t.check(await runTerminalBenchTests(sandbox), commandSucceeded());
          },
        );
      },
    });
  });
}
```

`task.yaml` 是动态输入；Zod decoder 在 loader 边界验证完整结构，只有验证后的领域值才进入 Eval 定义。

这里的 `environment` 是 adapter 产出的内部投影,不是要求 Eval 作者理解 Provider runtime。
`terminalBenchTaskEnvironment()` 只返回 provider-neutral Compose source;Docker、E2B 或其它 Provider 仍由 Experiment 的 SandboxSpec 选择。

## 迁移映射

| 上游事实 | NiceEval 归属 | 可见时机与身份 |
|---|---|---|
| `task.yaml` instruction、timeouts、tags | Eval definition | 发现期读取,进入 Eval 数据指纹 |
| Compose、Dockerfile、公开 build inputs | Environment source | build/start 前交给 materializer,进入 BuildKey / CaseKey |
| `run-tests.sh`、`tests/**` | hidden verifier | 最后一次 Agent turn 后挂载,进入判据指纹 |
| `solution.sh`、`solution.yaml` | private reference | 永不进入 build context、Sandbox 或 Agent 可见面 |
| 上游要求的容器名、镜像名、日志与 test env | Terminal-Bench compatibility adapter | 确定规则进入 CaseKey,逐 Attempt 值进入运行事实 |

materializer 必须构造过滤后的 build context。
即使上游 Dockerfile 后续增加 `COPY . .`,private reference 与 hidden verifier 也不能被发送给 Docker daemon;Compose bind mount 同样要经过泄漏检查。

## Experiment

baseline 只选择能消费 Compose source 的 Docker SandboxSpec:

```typescript
export default defineExperiment({
  evals: ["terminal-bench/"],
  sandbox: dockerSandbox({
    materializers: {
      compose: dockerComposeMaterializer(),
    },
  }),
  agent: codexAgent(),
});
```

mempal 变体复用同一批 Eval,只在 SandboxSpec 上增加 setup:

```typescript
export default defineExperiment({
  evals: ["terminal-bench/"],
  sandbox: dockerSandbox({
    materializers: {
      compose: dockerComposeMaterializer(),
    },
  }).setup(mempalSetup({
    version: "0.9.0",
    modelDigest: MODEL_SHA256,
    distribution: stagedMempalPayload(),
  })),
  agent: codexAgent({ skills: [mempalSkill] }),
});
```

题目不能访问外网时,mempal 的 `prepare` 在宿主侧取得锁定 payload,再通过 Sandbox 文件 API 上传和安装。
它不要求改 100 多份 task Dockerfile,也不把实验工具烘进上游 dataset。

## 运行路径

```text
原始 task package
  -> Terminal-Bench dataset adapter 派生 EvalDef + Compose source
  -> Docker Compose materializer build/up
  -> 选择 client 作为唯一主 Sandbox
  -> SandboxSpec 的 mempal setup 检查并按需安装
  -> AgentProvisioner Ensure Codex
  -> Agent turn
  -> turn 后挂载 run-tests.sh 与 tests/**
  -> 执行官方 verifier 并清理隐藏材料
```

若改用不能按 Compose source 构建并启动 Sandbox Case 的 Provider,只有两种诚实结果:

- SandboxSpec 为具体 environment profile 提供等价的预制完整 case。
- 没有覆盖的 task 在计划期 `skipped`。

Runner 不能回退到 Experiment 默认 template,因为那会丢掉 task package 规定的环境。
