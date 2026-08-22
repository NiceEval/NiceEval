# DinD data allocation取代大 tmpfs

**裁决（2026-08-22）**：inner `/var/lib/docker`使用部署期预建、每 Attempt私有、disk-backed且带
project quota hard limit的 Docker data allocation。watchdog按完整状态机租用、scrub和验证 allocation；任何不确定状态都
进入 `quarantined`，不跨 Attempt复用已写内容。

作者声明 `dockerDataBytes`，planner将它规范化为跨进程准入向量中的 `ephemeralDiskBytes`。磁盘准入
只按已兑现物理容量计算，禁止用 sparse apparent size、thin pool未兑现空间或压缩估计超卖。

**翻案**：`/var/lib/docker`使用大 tmpfs的方案作废。inner image与 layer会把磁盘压力转成 memory
cgroup压力，既压缩 Agent可用内存，也不能提供独立的磁盘准入与强杀后 scrub证据。

raw与 managed是两个独立交付门。raw必须显式选择 `storageProfile`，只承诺
`raw-dind-storage/v1`的 quota、admission和 recovery；managed包含同一 storage capability并继续证明
rootless、cgroup、网络和共享宿主边界。v1只支持 Linux、systemd、cgroup v2和可证明的 project quota。

**容量基准**：默认 filesystem为32 GiB、allocation为8 GiB、并发2路。4路与8路分别至少晋升到64 GiB与
128 GiB，并保留同等比例的 daemon、build、scrub与 recovery headroom。
