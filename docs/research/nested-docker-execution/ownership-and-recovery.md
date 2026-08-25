# 所有权与恢复

> 观察日期：2026-08-25

## mount namespace 会改变“看见同一路径”的含义

systemd 的文件系统隔离选项会为 unit 建立私有 mount namespace。`ReadWritePaths=`、
`BindPaths=` 等设置并不只是权限清单；它们可以建立 bind mount。详见
[systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)。

如果 activation 在宿主 namespace 把 4 GiB filesystem 挂到某个子目录，而 watchdog unit 随后把
其父目录 bind 进自己的 namespace，watchdog 看到的 pathname 可以与宿主相同，背后的 mount tree
却不同。`findmnt` 的缓存或路径展示不能替代 `statfs`、device identity 与 mount propagation 的
一致证明。

这类故障的根因不是少一条 `ReadWritePaths`。根因是 activation 和 watchdog 都参与同一份 host
mount 生命周期，却不共享 namespace 与单一 owner。修正一个遮蔽点后，rebuild、restart、recovery
或另一层 bind mount 仍可能重新制造不一致。

## 唯一 owner 的可执行含义

专用 kernel Sandbox 把边界切成三层，每层只有一个 mutation owner：

| 资源 | 唯一 mutation owner | NiceEval 可做什么 | NiceEval 不做什么 |
|---|---|---|---|
| host pool、VM root disk、Docker data virtual disk、host mount | Provider daemon | create、inspect、snapshot、clone、destroy API | mount、umount、loop attach、fsck、raw copy |
| guest 内 filesystem mount、dockerd 与 transient socket | guest init / guest agent | readiness、quiesce、shutdown 请求 | 从宿主直接改 guest mount tree |
| Attempt lease、generation、allocation intent 与结果 | NiceEval control plane | durable ledger、fencing、reconcile | 把 pathname 或 PID 猜成 ownership proof |

Incus 适合这个分工，因为它已经拥有 instance inventory 与 storage pool。托管 Sandbox Provider 也应
通过 API 给出相同的 create/inspect/destroy 事实。NiceEval adapter 可以转换事实，不能重新拥有底层
mount。

## durable identity 先于 cleanup

资源创建必须使用 journal-first intent。NiceEval 在调用 Provider 前写入 allocation id、Attempt id、
generation、requested capability、quota 与期望终态；Provider 创建的所有对象都携带同一组 metadata。
只有 locator 与 generation 持久化成功后，实例才可交给 Agent。

cleanup 不是“按进程扫描并尽量删”。它必须用 ledger 与 Provider inventory 做集合对账：

- ledger active，Provider object 存在且 generation 相同：由原 owner 继续，或在 owner 丢失后销毁；
- ledger active，Provider object 不存在：Attempt 记为 environment incomplete，不重新执行 Agent turn；
- ledger terminal，Provider object 仍存在：detached destroy；
- Provider object 带 NiceEval metadata，但 ledger 无 durable fact：隔离并销毁，不自动收养；
- identity、容量或 generation 不一致：只 quarantine 该 allocation 或 artifact，并继续核对其它对象。

每个 API 都必须幂等。destroy 对“已经不存在”返回成功事实；重复 create 只能找到同 generation 对象，
不能静默生成第二台 VM。

## DestroyOnly 是 V1 的恢复边界

控制平面可恢复，不代表 Agent turn 可再次执行。CLI 被 `SIGKILL`、Provider client 丢失、VM 消失或宿主
重启后，V1 把在飞 Attempt 标为 `environment incomplete`，fence 旧 generation，并销毁 VM、磁盘、
network 与 lease。新的 Invocation 可以从相同 trusted SetupPrefix 和 Provider artifact 再开始，
但不会自动重新发送模型请求，也不会再次执行已有外部副作用的 turn。

真正的 resume 需要独立的 checkpoint、模型受理状态与外部副作用幂等协议。把“VM 磁盘还在”当作
可恢复 Attempt，会把基础设施存活误写成业务执行 exactly-once。

## 旧 pool 是外部对象

没有新 ledger 与 Provider metadata 的 `/data/niceeval-dind-pool.img` 不属于新执行域。新系统不得
发现后自动 attach、mount、fsck、rename、adopt 或 delete。配置显式指向它时应在任何写入前拒绝，
并提示由操作者在 NiceEval 之外决定保留或处置。
