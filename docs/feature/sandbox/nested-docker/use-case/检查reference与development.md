---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# 检查 reference 与 development

部署者要确认 Incus Provider 能不能承接 nested Docker。
reference 与本机 development 必须分开看，不能用其中一条绿灯代替另一条。

## 主要调用

默认检查 reference：

```bash
niceeval sandbox provider doctor incus
```

本机开发例外另走一条命令：

```bash
niceeval sandbox provider doctor incus --development
```

然后再做不调用模型的计划核对：

```bash
niceeval exp <experiment> --dry
```

## 反馈

reference doctor 必须显示 dedicated block-backed attested capacity、execution domain、trusted image 与 inventory。
loop-backed pool 或目录配额在这里失败。
doctor 只读，不 create、不 destroy allocation。

`--development` 只证明 development domain 与 storagePool `niceeval-sandbox-dev` 这一条例外。
它不是 reference，不把容量写成 attested，也不会让未写 `acceptDevelopmentDomain: true` 的 Experiment 通过 planning。

`--dry` 列出 exact requirement、capability 与 `acceptDevelopmentDomain`。
development Experiment 必须显示 `capacity._tag === "Unattested"`，并被标成 non-comparable。

本机开发 Experiment 的 factory 形状是：

```ts
incusSandbox({
  image: "niceeval/docker-execution-v1@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  project: "niceeval-eval-dev",
  storagePool: "niceeval-sandbox-dev",
  acceptDevelopmentDomain: true,
})
```

## 边界

- development 通过、reference 失败时，默认 doctor 仍失败。
- reference 通过不表示 development path 存在。
- 旧 `/data/niceeval-dind-pool.img` 不被打开、挂载、adopt 或删除。
- 任一失败都不回退宿主 socket 或 DinD。

## 替代

只想看留存现场或孤儿实例时，使用既有 `niceeval sandbox list` / `prune`。
那组命令不替代 provider doctor，也不能证明 `docker/v1`。
