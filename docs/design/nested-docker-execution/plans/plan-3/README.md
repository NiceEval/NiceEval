# PLAN-3 —— 直接绑定 Incus VM Provider

## 调用面

Experiment 直接选择 Incus，Eval 通过与之配对的 Sandbox layer 取得 Docker：

```ts
const GiB = 1024 ** 3;

incusSandbox({
  image: "niceeval/docker-execution-v1",
  project: "niceeval-eval",
  storagePool: "evals",
  resources: {
    cpus: 4,
    memoryBytes: 6 * GiB,
    dockerDataBytes: 4 * GiB,
  },
});
```

`incusSandbox()` 同时选择 Provider 与完整 Sandbox origin，符合现有 `SandboxTemplate` 规则。
Eval/Experiment 文件因而直接依赖 Incus 名称与 locator policy。

## 架构

每条 Attempt 从 Incus image 或 verified snapshot 创建一台 VM。VM 有独立 guest kernel、root disk、
workspace disk、4 GiB Docker data virtual disk和网络。guest 以普通 systemd unit 启动 Docker；Agent 在
guest 主 Sandbox 内运行，通过本机 Unix socket使用私有 daemon。

Incus daemon 是 host storage、instance、virtual disk、snapshot、clone、mount 与 destroy 的唯一 owner。
NiceEval adapter 只使用 Incus API，不读取 `/var/lib/incus`，不操作 host mount，也不保存 loop device。
NiceEval durable ledger 保存 Attempt、allocation、Incus instance UUID、generation 与期望终态。

NixOS deployment 可以为 `/data` 建立专用 ZFS、Btrfs 或 LVM-thin pool。storage driver 不进入 Eval identity；
Provider receipt 仍核对 logical quota、artifact manifest、pool execution-domain id 与 clone isolation。

## 缓存

受信任 prepare VM 从 exact image 执行 SetupPrefix，按 quiesce 协议关停 Docker 和 guest，再由 Incus 发布
immutable snapshot/image。每条 Attempt 从 artifact clone 私有 root/data disk。OCI mirror 与 BuildKit
external cache承担大部分跨任务内容复用；普通 Attempt 的写入只进入私有 namespace，不自动 promotion。

## 生命周期与恢复

NiceEval 先写 allocation intent，再调用 Incus create。instance metadata 携带 allocation id、Attempt id、
generation 与 artifact identity。guest ready 同时验证 filesystem capacity、Docker/Compose version、默认
socket与没有宿主 endpoint，之后才把 Sandbox 交给 Agent。

cleanup 先 fence guest command channel，再要求 guest 停止 Docker，最后调用 Incus delete instance 与全部
attached volume/network。CLI 强杀或宿主重启后，reconciler 对账 ledger 与 Incus inventory；未完成 Attempt
标为 environment incomplete，并执行 detached destroy。

错误至少区分 `incus-unreachable`、`incus-capacity-unavailable`、`artifact-unverified`、
`guest-readiness-failed`、`allocation-lost` 与 `destroy-incomplete`。只 quarantine exact instance、volume
或 artifact；execution domain 本身不可验证时才停止新 admission。

## Cases

本候选能直接满足 C1–C10。C3 的性能取决于所选 storage driver 的 clone、guest boot、daemon ready 与
cache locality，必须实测。C11 可以用安装后 `niceeval exp` 验收。

## 评价

它把 mount、snapshot 与 instance inventory交给成熟 control plane，显著缩小 NiceEval 的正确性面，
也是 NixOS 自托管的最短终态实现。缺点是公开配置绑定 Incus；同一 Eval 要改跑托管 Sandbox 时需要另写
Provider-specific 实验声明，产品层无法表达“我需要专用 kernel Docker，具体 Provider 由 deployment 选”。
