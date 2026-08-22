# 固定 DinD runtime

Harness 的 outer image 携带固定 runtime archive。Docker BuildKey 命中时，每个新 DinD Sandbox 的 inner daemon 仍从空 data-root 启动。Experiment 因此 inline 注册低频 `.before(shell())` 导入固定 runtime，Eval 安装候选和 fixture，Agent 最后用高频 `.before(write())` 写普通 `.env`。

```text
BuildKey hit
  → runtime prefix hit (frequency 10)
  → candidate prefix hit (frequency 100)
  → adapter-env prefix miss (frequency 1000)
  → replay adapter-env only
  → optional promotion
  → private DinD clone
  → inject secret overlay
  → Attempt
```

首次运行从 base 创建 staging DinD，依次导入 runtime、安装经 dist-tag 身份查找得到的精确候选并写普通 fixture 配置。每个节点都产生链入 parent 的 SetupPrefixKey；Provider 可以优先 promotion 体积大、复用高的 runtime 前缀，而不必强制发布每个逻辑前缀。

第三次运行若两个 runtime archive、候选精确 digest 与 fixture 都不变，命中最终前缀，每个 Attempt 只创建私有 clone。若只改变 `.env` 的普通配置，runtime 和 candidate 前缀继续命中，只重新执行最后节点的 recipe。若 canary tag 的身份查找仍得到同一精确版本与包 digest，候选前缀命中；tag 更新时该节点及后缀自动 miss，不需要 `noCache`。

含 secret 的 `.env` 不进入 prefix。Adapter 可以用 `.before(write())` 写无密钥模板，但 token 由 Agent `around.before` 写入，并由配对 `around.after` 清除。

DinD 前缀必须先 quiesce inner dockerd/containerd，再原子捕获 outer rootfs 与私有 `/var/lib/docker`。只 commit outer container 或复制运行中的 data-root 都不满足一致性协议。
