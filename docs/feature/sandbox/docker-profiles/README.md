---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Docker 执行配置（Docker Profile）

本目录保留原 Docker Profile 入口，说明如何迁移到当前 nested-Docker public path。

Eval 在 Sandbox 内使用 Docker 的唯一契约是
[Nested Docker](../nested-docker/README.md)：
Eval 用 `sandboxLayer({ requirements: { nestedDocker } })` 声明 Nested Docker 要求。
该要求固定包含 `docker/v1` 与 `dedicated-kernel/v1`；Experiment 用 `incusSandbox()` 选择一次性 Incus VM。

`dockerSandbox({ dockerAccess })` 的宿主 Docker socket、raw privileged DinD 与
managed rootless DinD 不能满足这条能力。
Docker storage profile 只服务于这条缺口，不能生成 `dedicated-kernel/v1` receipt。
planning 不能把它们降为 fallback。
它们不属于支持目标。

## 核心心智

```text
adopted public path
  Eval sandboxLayer({ requirements: { nestedDocker } })
  + Experiment incusSandbox(...)
  -> disposable Incus VM + guest 普通 dockerd

not a public path
  dockerAccess mode socket | raw-privileged | managed-rootless
  -> 不能生成 dedicated-kernel/v1 receipt
  -> 不能回退、不能伪装成 nested Docker
```

## 入口

迁移页只保留外部链接仍指向的 Library、CLI 与 Architecture 页面。
不要从这些页面学习 nested Docker。

- [Nested Docker](../nested-docker/README.md) —— 唯一 adopted 契约。
- [Library](library.md) —— `dockerAccess` 不是 public nested-Docker factory。
- [CLI](cli.md) —— `niceeval docker profile *` 不是 adopted doctor。
- [Architecture](architecture.md) —— 旧 profile 资源与 SetupPrefix 资格的缺口说明。
- [Lifecycle](lifecycle.md) —— 旧 watchdog / loop 路径不是 DestroyOnly Incus 生命周期。
- [NiceEval-Eval 用例](use-case/niceeval-eval.md) —— 旧单容器 DinD 用例不是公开验收路径。
