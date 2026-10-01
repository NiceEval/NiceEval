# PLAN-1 —— 修正并保留 fixed-image DinD

## 调用面

Eval/Experiment 继续显式选择 Docker Provider、DinD 模式和宿主 profile：

```ts
const GiB = 1024 ** 3;

dockerSandbox({
  source: { type: "dockerfile", context: new URL("../sandbox/", import.meta.url) },
  dockerAccess: {
    mode: "dind",
    isolation: "managed-rootless",
    profile: "default",
  },
  resources: { dockerDataBytes: 4 * GiB },
});
```

作者与 deployment 都知道 fixed-image DinD。`dockerAccess`、profile 名、slot size 和缓存 state
继续成为产品概念。

## 架构

activation 拥有 backing image、loop device、filesystem format、registry epoch 与初始 mount。
watchdog 拥有 admission、lease、reservation、slot/seed journal、cleanup、quarantine 与 orphan recovery。
需要 restore/capture 时，watchdog 还会 mount、umount 或 raw copy Docker data image。

两者必须进入同一 mount namespace，或显式把每个 child mount 传播进 watchdog namespace。
所有 attestation 同时核对 `statfs`、mount source、filesystem UUID、loop backing、slot generation 与
Docker daemon generation。systemd hardening 不能再对 slot parent 建立遮蔽 child mount 的 bind。

## 缓存

确定性 setup-prefix 在 inner daemon quiesced 后复制完整 4 GiB filesystem image，改写 clone UUID，
再由新 slot 恢复。OCI registry mirror 与 BuildKit cache 可以补充，但不能替代 seed/slot 协议，因为
本候选的公开 `sandboxState.dockerData` 已承诺完整 data-root 命中。

## 生命周期与恢复

activation 以 pending/committed epoch 发布 backing 与 registry。watchdog 只接受 committed epoch，
为每条 Attempt 预留 slot，再启动 outer container 与 inner daemon。cleanup 必须停止所有 inner
container、BuildKit session、dockerd/containerd 与 outer container，卸载 slot后才可 copy、scrub 或重租。

CLI 强杀时 watchdog 通过 container metadata、lease token、PID、loop/mount facts 与 journal 对账。
宿主重启时 activation 重建 loop/mount，watchdog 再恢复 reservation。任何物理事实不一致都 fail closed。

错误至少区分 `profile-unavailable`、`slot-attestation-failed`、`slot-full`、`quiesce-failed`、
`seed-unverified` 与 `recovery-incomplete`。为防错误 slot 被重用，attestation failure 会 quarantine exact
slot；无法证明 epoch 或 parent mount 时关闭 profile admission。

## Cases

- C1/C2 可由四个 fully allocated slot 达到，但每个新 slot 都扩大 loop、mount 与 journal 状态空间。
- C3 依赖 raw Docker data copy；warm 性能受固定 4 GiB copy、fsck 与 daemon stop/start 影响。
- C4 只有 quiesce、copy、UUID、seed immutable 与每次 cleanup 全部正确时成立。
- C5/C6 需要 activation、watchdog、systemd namespace 与 Docker 三方恢复协议。
- C7 容易把 parent/epoch 不确定性升级为 profile-wide admission close。
- C9 要精确继承 activation-owned registry epoch，同时丢弃旧物理 journal facts。

## 评价

这个候选可以修正已知遮蔽，但不能消除根因模型。mount、loop、Docker data、journal 与进程 owner 仍在
两个宿主服务和两个 namespace 之间耦合。每次 systemd hardening、policy rebuild 或 recovery 都可能改变
“相同 pathname”的实际对象。它保留最多现有代码，也保留最高的长期正确性与运维成本。
