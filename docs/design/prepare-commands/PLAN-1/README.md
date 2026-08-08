# PLAN-1:官方内置命令库与 `--dry` 复用成本视图(推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md)

## 方案定位

在 `niceeval/sandbox` 之上提供一小组官方内置命令,每个内置命令 都是 `defineSandboxCommand()` 的封装:检查、缺失时执行、执行后复检一次成型,identity 由纯数据参数构成。
Runner 与 SandboxLayer 协议一个字不改;内置命令对框架而言就是一条带稳定 identity 的 prepare 命令。

## 调用面示意

```typescript
import { checkout, installTool } from "niceeval/sandbox";

export default defineEval({
  sandbox: sandboxLayer()
    .prepare(checkout({
      repo: "https://github.com/acme/fixture-repo",
      ref: "9e107d9d",
    })),
  async test(t) { /* … */ },
});
```

```typescript
export default defineExperiment({
  sandbox: e2bSandbox({ template: "base-node-22" })
    .prepare(installTool({
      tool: "mempal",
      identity: { version: "0.9.0" },
      probe: shell("mempal --version"),
      install: shell("curl -fsSL https://get.mempal.dev | sh"),
    })),
  agent: codexAgent(),
});
```

## 机制

- `checkout()`:在 workdir 外维护按 `(repo, ref)` 键控的镜像;首条 Attempt 走网络,后续 Attempt 从镜像快速写入 workdir。identity 是 `(repo, ref)`,进入 fingerprint 与复用池的现有规则。
- `installTool()`:探测命中即返回;未命中执行 install 并复检,复检失败按执行失败计。identity 是 `tool + identity` 参数。
- `--dry` 复用视图:内置命令声明自己的成本类别(命中型),普通 command 一律标注每题重新执行;逐命令展示类别与依据。

## 守护

| Case | 路径 |
|---|---|
| C1 | `checkout()` 镜像缓存;第二条 Attempt 起零网络 |
| C2 | `installTool()` 探测命中;identity 变化重装并复检 |
| C3 | 内置命令携带成本类别,`--dry` 逐命令展示 |
| C4 | 不新增 fixture API;物料继续走现有登记与上传 |

## 代价与义务

- 采纳即翻案 memory 旧裁决「不配官方 fixture 装载 API」,须在 memory 登记新理由(复用缓存与稳定身份)与旧判据(绕行自设地雷)的差异。
- 内置命令集合是公开面,进入参考页与 docs-site 的维护范围。
- 镜像缓存位置属于 内置命令内部约定,必须写明它服从 reset 与活状态边界,不被 `onCleanup` 删除。
