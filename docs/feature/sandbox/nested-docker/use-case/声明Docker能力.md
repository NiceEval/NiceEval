---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 声明 Docker 能力

题目需要 Agent 在评估现场里运行 Docker 与 Compose。
Eval 只声明能力，不选择 VM；Experiment 选择一次性 Incus 起点。

## 主要调用

Eval 保持 command-only：

```ts
import { defineEval } from "niceeval";
import { sandboxLayer } from "niceeval/sandbox";

const GiB = 1024 ** 3;

export default defineEval({
  sandbox: sandboxLayer({
    requirements: {
      nestedDocker: {
        compose: "v2",
        minimumDataBytes: 4 * GiB,
      },
    },
  }),
  async test(t) {
    await t.send("用 docker compose 安装并验证服务。");
  },
});
```

对照 Experiment 带 template：

```ts
import { defineExperiment } from "niceeval";
import { incusSandbox } from "niceeval/sandbox";
import { codexAgent } from "niceeval/adapter";

const GiB = 1024 ** 3;

export default defineExperiment({
  agent: codexAgent(),
  maxConcurrency: 4,
  sandbox: incusSandbox({
    image: "niceeval/docker-execution-v1@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    project: "niceeval-eval",
    storagePool: "niceeval-evals",
    resources: {
      cpus: 4,
      memoryBytes: 6 * GiB,
      dockerDataBytes: 4 * GiB,
    },
  }),
});
```

## 反馈

`niceeval exp <experiment> --dry` 显示 requirement 已被 Incus capability 满足。
它同时显示 `acceptDevelopmentDomain` 的 identity 值。
不调用模型，不创建 Eval allocation。

reference identity 的成功输出不省略默认 `false`，因而能与显式 `false` 对照：

```text
$ niceeval exp docker-evals --dry
SANDBOX PLAN
requirement: docker/v1 · compose v2 · dedicated-kernel/v1 · data >= 4 GiB
provider: incus
domain: reference
capacity: Attested
acceptDevelopmentDomain: false
identity: sandbox/incus/reference/attested/acceptDevelopmentDomain=false
```

development 只有显式 opt-in 才能形成另一条 identity；省略 opt-in 的 development capability 不会降级通过：

```text
$ niceeval exp docker-evals-dev --dry
niceeval error: sandbox-capability-unsatisfied
requirement: docker/v1 · compose v2 · dedicated-kernel/v1 · data >= 4 GiB
available: incus development domain · capacity Unattested
hint: choose reference capacity or set acceptDevelopmentDomain: true on incusSandbox()

$ niceeval exp docker-evals-dev --dry
SANDBOX PLAN
requirement: docker/v1 · compose v2 · dedicated-kernel/v1 · data >= 4 GiB
provider: incus
domain: development (non-comparable)
capacity: Unattested
acceptDevelopmentDomain: true
identity: sandbox/incus/development/unattested/acceptDevelopmentDomain=true
```

正式运行里，每条 Attempt 的公开命令证明 `docker info`、`docker run` 与 `docker compose` 使用
sandbox-private daemon。
workdir 是 `/home/sandbox/workspace`，执行身份是 `node` uid 1000。

## 边界

- 两边都写 template，或两边都不写，仍是既有 `sandbox.template-conflict` / `sandbox.template-missing`。
- Experiment 换成 `dockerSandbox({ dockerAccess })` 不能满足 `dedicated-kernel/v1`。
- `--keep-sandbox` 与 `sandboxReuse: true` 在创建资源前失败。
- 本机开发例外必须显式 `acceptDevelopmentDomain: true`，并使用 project `niceeval-eval-dev` 与 storagePool `niceeval-sandbox-dev`；省略时只走 reference。

## 替代

题目不需要 Docker API 时，不要写 `requirements.nestedDocker`。
普通 `dockerSandbox({ source })` 仍可做无 nested Docker 的单容器起点。
