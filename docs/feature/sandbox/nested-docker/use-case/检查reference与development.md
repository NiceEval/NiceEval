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

Provider inventory 中带 NiceEval prepared-artifact metadata 的对象，必须有同 project、同 exact locator 的
`ArtifactIntent`。缺少 intent 时，doctor 必须失败，并列出 virtual-machine instance 或 custom storage volume 的
project、kind 与 name。

建议以该 exact locator 为 quarantine key。doctor 不 adopt、不补写 intent，也不删除对象。一个对象无法闭合时，
doctor 不能只按已登记 intent 计算空闲槽位并报告通过。

reference 成功时，Human 输出把两个容量面和 domain 一起列出：

```text
$ niceeval sandbox provider doctor incus
INCUS REFERENCE DOCTOR · PASS
domain: reference
execution: dedicated block-backed attested capacity
runtime allocations: 4 free / 4 total
prepared artifacts: 2 free / 3 total
trusted image: niceeval/docker-execution-v1@sha256:0123456789abcdef…
inventory: project niceeval-eval · storage pool niceeval-evals
```

缺任一 artifact 槽位即使 warm artifact 仍能命中也整体失败，且 doctor 不会顺手回收：

```text
$ niceeval sandbox provider doctor incus
INCUS REFERENCE DOCTOR · FAIL
domain: reference
runtime allocations: 4 free / 4 total
prepared artifacts: 0 free / 3 total
reason: prepared artifact capacity is exhausted
hint: wait for consumer leases to reach zero or run the provider reconciler
```

`--development` 只证明 development domain 与 storagePool `niceeval-sandbox-dev` 这一条例外。
它不是 reference，不把容量写成 attested，也不会让未写 `acceptDevelopmentDomain: true` 的 Experiment 通过 planning。

development 的绿灯仍明确标成不可与 reference 比较；reference 检查失败时也不会被它替代：

```text
$ niceeval sandbox provider doctor incus --development
INCUS DEVELOPMENT DOCTOR · PASS
domain: development (non-comparable)
execution: local development exception
runtime allocations: 1 free / 1 total
prepared artifacts: 1 free / 1 total
inventory: project niceeval-eval-dev · storage pool niceeval-sandbox-dev
```

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
