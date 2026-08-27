# Docker 执行配置 —— Library

`dockerSandbox()` 的 adopted 公开形状没有 `dockerAccess`。
Agent 需要 Docker API 时，使用 [Nested Docker Library](../nested-docker/library.md) 的
`sandboxRequirements()` 与 `incusSandbox()`。

## 不是 public path 的 access

下列写法不能满足 `docker/v1` 与 `dedicated-kernel/v1`，也不能互相降级或回退：

```ts
dockerSandbox({
  source: { type: "image", image: "..." },
  dockerAccess: { mode: "socket", socketPath: "/var/run/docker.sock" },
})

dockerSandbox({
  source: { type: "image", image: "..." },
  dockerAccess: { mode: "dind", isolation: "raw-privileged" },
})

dockerSandbox({
  source: { type: "image", image: "..." },
  dockerAccess: {
    mode: "dind",
    isolation: "managed-rootless",
    profile: "default",
  },
})
```

它们不属于支持目标。
普通无 Docker API 的单容器起点仍然是 `dockerSandbox({ source })`，不挂 socket，也不启动 guest dockerd。

## 非法组合

| 输入 | 结果 |
|---|---|
| Eval `sandboxRequirements({ docker })` 配 `dockerAccess` | `sandbox-capability-unsatisfied` |
| managed 失败后改 raw 或 socket | 禁止 fallback |
| 把 `sandboxState.dockerData` 当作 nested Docker cache | 不是 public state surface |
