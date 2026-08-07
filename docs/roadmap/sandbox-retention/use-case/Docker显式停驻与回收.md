# Docker 显式停驻与回收

Docker stopped container 没有服务端到期，会持续占用本机磁盘。
因此 Docker 不通过默认 `auto`，但项目可以一次性接受这项边界：

```ts
// niceeval.config.ts
export default defineConfig({
  sandboxRetention: {
    release: "retain",
    retain: "failed",
    idleTtlMs: 24 * 60 * 60_000,
    maxActiveMs: 60 * 60_000,
    maxStoppedPerRecordRoot: 20,
  },
});
```

Agent 使用非 root execution identity。
Provider、Invocation 与 Attempt 都不能给出更早 deadline 时，Docker managed case 使用有限 `maxActiveMs`。
这让父进程崩溃后，root-owned PID 1 deadline 仍能停止 container。

之后普通运行无需每次指定 keep：

```bash
niceeval exp local onboarding/tool-first
```

失败 Sandbox 完成 teardown 后映射为 `docker stop`。
摘要明确显示 `no provider expiry` 和本地回收入口。

```bash
niceeval sandbox list
niceeval sandbox enter rtn_91c2
```

enter 的 shell 退出后再次停驻。
如果 Sandbox 仍 active，可以显式停驻：

```bash
niceeval sandbox suspend rtn_91c2
```

不再需要时直接销毁：

```bash
niceeval sandbox delete rtn_91c2
```

按 TTL 与单 record root 数量上限回收时，先预览：

```bash
niceeval sandbox prune --dry
niceeval sandbox prune
```

`maxStoppedPerRecordRoot` 不约束其它 checkout 或 registry，也不在没有 NiceEval 进程时按墙钟执行。
定期回收需要由用户或计划任务调用 `prune`；文档不能把机会式 GC 描述成 Docker TTL。

unverified resource 不被 prune。
Provider metadata、主 Sandbox 及伴随资源身份或 lease 无法核验时，命令保留条目并非零退出，用户到 Docker 控制面核对。
