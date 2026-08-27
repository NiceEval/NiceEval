# Limits

## 部署与容量

- 宿主是 NixOS，持久存储位于 `/data`。换成 Ubuntu 不构成根因修复。
- 目标并发为四个 allocation，每个 Docker data hard limit 为 4 GiB。
- Attempt 不得取得 `/var/run/docker.sock` 或其它宿主 daemon endpoint。
- 失败不能静默回退到 raw privileged DinD、shared daemon 或 shared writable data。
- `/data/niceeval-dind-pool.img` 是未受新 execution domain 管理的外部对象。
  任何候选都不得自动收养、修改或删除它。

既有 fixed-image profile 使用 112 GiB outer ext4 store、四个 4 GiB writable slot 和十个 setup-prefix
seed。NiceEval-Eval 的固定 runtime setup 只导入一到两个 digest-pinned image tar。为这类输入复制整份
Docker data filesystem，会保存远多于任务需要的 daemon state。

## 已观察故障的根因模型

现有 fixed-image DinD 把同一份 host mount lifecycle 分给 activation 和 watchdog。activation 在宿主
namespace 把 4 GiB loop-ext4 slot 挂到子目录；watchdog 的 systemd unit 又通过父目录
`ReadWritePaths` 建立私有 bind mount。结果是相同 pathname 和 `findmnt` source 之下，watchdog 的
`statfs` 实际落到 112 GiB outer filesystem。

这个现象说明三项身份被错误合并：

1. registry 声称的 allocation identity；
2. 某个 namespace 内 pathname 对应的 mount identity；
3. Docker daemon 正在使用的 data-root identity。

watchdog 依据错误的 filesystem facts 执行 quota attestation 和 cleanup，继而 quarantine slot、关闭
全局 admission。install 与 harness 在 Attempt dispatch 和模型调用前失败，没有 score。

提交 `0fc97d5cc` 和 infra `6f28a823` 修正了这一次父目录遮蔽与部署版本，但不改变 dual-owner
模型。它们是事故防护证据，不是终态架构依据。

## 已暴露的状态空间

- access group 配置改变后，长期登录进程可能没有刷新 supplementary groups；
- digest-pinned DinD/BuildKit asset、activation registry epoch 与 policy revision 必须一致；
- watchdog journal 可能保留已经失效的 slot、seed 与 daemon 物理事实；
- activation 中断会留下 pending marker，后续进程必须 fail closed；
- loop backing、PID ownership、reclaim timeout、reboot recovery 与 seed copy 都曾进入同一正确性面。

候选不能只修一个 mount path。它必须减少“谁能改变同一资源”的 owner 数量，并让 recovery 读取
Provider inventory 与 durable identity，而不是从 pathname、PID 或旧 journal 推断。

## NiceEval 已有产品边界

- `SandboxTemplate` 是作者选择 Provider 与完整 Sandbox origin 的起点，不改名为 VM snapshot。
- `SetupPrefix` 是确定性 before action 的逻辑内容前缀。
- Provider 捕获的 image、template、snapshot 或 volume 结果统一叫 `Provider artifact`。
- `SandboxCase` 仍返回唯一主 Sandbox；Agent、Eval、文件 API、workdir 与 diff 都锚定它。
- BuildKey、CaseKey、activity、Sandbox Operations 与 Record 公开观察不因底层换 VM 而另造一套。

## 外部产品事实

产品、snapshot 和缓存事实见[嵌套 Docker 研究](../../research/nested-docker-execution/README.md)。
关键限制是：Docker Sandboxes 的 Linux 支持面不含 NixOS；Runloop 的评估级回收与容量仍需 PoC；
Incus 提供 VM 与 storage control plane，但不替 NiceEval 决定 Attempt 受理、结果或 replay 语义。

## 验收边界

- 不读取 NiceEval Record 私有文件、Provider 私有数据库或 raw snapshot 内容证明通过。
- 真实模型调用属于付费 dogfood，执行前仍需当次用户授权。
- warm 加速必须比较公开 timing 与 cache activity，不能只展示后端对象存在。
