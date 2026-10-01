# PLAN-2 —— 静态 slot 与长期 DinD

## 调用面

作者仍使用 `dockerSandbox()` 与 `managed-rootless` profile。区别只在 deployment：profile 声明固定数量
的静态 slot，activation 在开机时一次性 mount 并启动长期 outer container/inner daemon。

```nix
services.niceeval.dockerProfiles.default = {
  slots = 4;
  dockerDataSize = "4G";
  lifecycle = "static";
  cache = {
    registryMirror = "https://registry-cache.internal";
    buildkit = "registry.internal/niceeval/buildcache";
  };
};
```

watchdog 只发 lease，不执行 mount、umount、loop attach、fsck 或 raw seed copy。

## 架构

activation 是 host mount 的唯一 owner。四个 slot 在 committed policy 生效后长期存在，slot supervisor
拥有 outer container 与 inner daemon。watchdog 只持 durable lease table、capacity 和 fencing token，
通过 supervisor RPC 请求 reset、health 与 destroy。

systemd unit 必须共享 activation 所在 mount tree，或根本不读取 slot pathname。doctor 默认只读
supervisor/lease facts；探测操作只能申请一条自己的 lease，不能运行其它 active slot 的 Provider finalizer。

## 缓存

本候选不复制整个 Docker data image。所有 daemon 从受控 OCI registry/mirror 拉取 digest-pinned image，
并从 BuildKit registry cache 读取 build result。每个 slot 的 `/var/lib/docker` 仍私有且长期存在。

跨 Attempt 保留 inner image cache 可以加速，但也让 cleanup 成为安全边界。结束时必须删除所有 container、
volume、network、builder、credential、secret 与 workspace，并证明 daemon event/state 不携带前一条 Attempt。
无法分类的 Docker state 必须把整个 slot 交给 activation 离线重建，不能靠 `docker system prune` 宣称干净。

## 生命周期与恢复

开机 activation 完成四个 mount 和 supervisor 后发布 committed generation。watchdog 只把 ready slot 分给
Attempt。Attempt 结束时 supervisor 执行 reset receipt，watchdog 只有收到 receipt 才释放 lease。

CLI 强杀时 watchdog fence lease，并要求 supervisor 停止 Agent/Compose、删除私有 daemon state。宿主重启后，
activation 重新建立同一批 slot，再把所有未完成 lease 送入离线 reset；这些 lease 对应的 Attempt 标记为
environment incomplete。

错误至少区分 `slot-not-ready`、`lease-fenced`、`reset-unverified`、`docker-capacity-exhausted` 与
`profile-generation-mismatch`。reset 无法证明时 quarantine exact slot；四个 slot 都不可信才关闭 admission。

## Cases

- C1/C2 的 capacity 简单明确，mount 不随 Attempt 变化。
- C3 主要依靠 registry 与 BuildKit，避免 4 GiB raw copy；固定 runtime pull 可以命中。
- C4 是主要弱点。Docker data 长期存活，必须证明所有可观察 state 已清除。
- C5/C6 的 mount owner 更清楚，但 activation 仍承担特殊 slot rebuild 与 reboot 协调。
- C7 可以局部 quarantine，比 PLAN-1 更好。
- C9 仍要处理长期 slot generation 与 policy revision 的继承。

## 评价

这是 DinD 能达到的较小状态空间：watchdog 不再碰 mount，缓存也回到 registry/BuildKit。
但长期 daemon 复用把“没有泄漏”变成 Docker 内部状态清单，离线重建又把 activation 拉回 Attempt recovery。
它适合受信任 CI runner，不适合把不可信 Coding Agent 的完整 Docker 权限当成 NiceEval 终态。
