---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Nested Docker —— 在 Sandbox 里使用 Docker

Coding Agent 经常要在评估现场里执行 `docker build`、`docker run` 与 `docker compose`。
这件事是 Eval 对 Sandbox 必须兑现的能力要求，不是 Docker Profile、宿主 socket 或 Provider 产品名。

Eval 用 `sandboxRequirements()` 声明 `docker/v1`、Compose、专用 kernel 与最低 data capacity。
Experiment 用 `incusSandbox()` 选择一台一次性 Incus VM，兑现这些要求。
配对规则仍是现有 Sandbox Layer：Eval 这一侧是 command-only，Experiment 这一侧带 template。

V1 只承诺具名能力 `docker/v1`。
它不承诺 Agent 可以再创建另一台 NiceEval Sandbox，也不把 Kubernetes、Firecracker API 或第二层 control plane 交给 Agent。

## 核心心智

```text
Eval
  sandboxRequirements({ docker: docker/v1 + dedicated-kernel/v1 + Compose + minimumDataBytes })
  -> command-only layer，不选择 Provider

Experiment
  incusSandbox({ image, project, storagePool, resources?, acceptDevelopmentDomain? })
  -> 一次性 Incus VM，专用 guest kernel，guest 内普通 dockerd

planning
  -> 比较 requirement 与 capability receipt
  -> 不满足则 sandbox-capability-unsatisfied
  -> 不尝试 socket、DinD 或其它 Provider
```

每条 Attempt 得到一台 disposable VM。
主 Sandbox 是 guest 工作空间；Agent、Eval test、文件 API 与 diff 都在这里运行。
guest 内普通 Docker daemon 监听本机 Unix socket。
Docker data 使用与 root、workspace 分开的私有 virtual disk。

“nested”只描述用户看见 Docker 跑在评估 Sandbox 里面。
实现层不要求 Docker-inside-Docker。

## 唯一公开路径

nested Docker 的 adopted public path 只有这一组 factory：

```ts
sandboxRequirements({
  docker: {
    api: "docker/v1",
    compose: "v2" | "not-required",
    isolation: "dedicated-kernel/v1",
    minimumDataBytes,
  },
})

incusSandbox({
  image, // digest-pinned locator
  project, // reference: niceeval-eval；development: niceeval-eval-dev
  storagePool, // reference: niceeval-evals；development: niceeval-sandbox-dev
  resources?: { cpus?, memoryBytes?, dockerDataBytes? },
  acceptDevelopmentDomain?: boolean, // 默认 false
})
```

完整形状、identity 与错误码见 [Library](library.md)。

`dockerSandbox({ dockerAccess })` 的宿主 socket、raw privileged DinD 与 managed rootless DinD
不是这条路径，也不能降为 fallback。
它们不能满足 `docker/v1` 与 `dedicated-kernel/v1`，属于待移除的实现缺口。
缺口说明见 [Docker 执行配置](../docker-profiles/README.md)。

## 范围

本主题包含：

- Eval 的 provider-neutral `sandboxRequirements()`；
- Experiment 的 `incusSandbox()` 与 DestroyOnly 生命周期；
- reference 与 development 两个 execution domain；
- `niceeval sandbox provider doctor incus [--development]` 的只读 fail-closed 诊断；
- image trust、capability 绑定与安全边界。

本主题不包含：

- 把宿主 Docker socket 交给 Agent；
- raw / managed DinD outer container；
- `--keep-sandbox` 或 `sandboxReuse`；
- `sandboxState.dockerData` 特殊缓存；
- NiceEval 在宿主上 mount、loop、nft、sudo、build、import 或 pull **base image**；
- 把 development 绿灯当成 reference 通过。

`image` 仍是 exact trusted base，不是业务 cache 的公开入口。NiceEval 不 build、import 或 pull 这个
base；但在它之上，NiceEval 可以创建 Provider-native 的派生 preparation artifact，以复用已经验证的
声明式 SetupPrefix。它不是 Incus image，也不增加 cache factory、cache handle 或 Agent adapter API。

## 入口

- [Library](library.md) —— `sandboxRequirements()` 与 `incusSandbox()` 的公开形状。
- [CLI](cli.md) —— doctor、`--development`、`--dry` identity。
- [Architecture](architecture.md) —— requirement / capability、domain、信任与安全边界。
- [Lifecycle](lifecycle.md) —— planning、DestroyOnly、doctor 与 fail-closed。
- [用例](use-case/README.md) —— 声明能力与检查 domain。
