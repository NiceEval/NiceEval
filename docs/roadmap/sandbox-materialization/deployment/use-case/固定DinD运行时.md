# 固定 DinD runtime

## 起点

Harness 的 outer image 已携带两个固定 runtime archive。Docker BuildKey 在 Dockerfile、context 与基础镜像不变时命中；每个新 DinD Sandbox 的 inner daemon 仍从空 data-root 启动。

Experiment 把 archive digest 与候选 package input 声明为 Deployment inputs，并把导入脚本声明为 `DeploymentCommand`。canary tag 在 planning 中查找精确版本和包 digest。

## 首次运行

```text
BuildKey hit
  → DeploymentKey miss
  → create staging DinD Case
  → inner dockerd ready
  → import fixed runtime images
  → quiesce inner dockerd/containerd
  → publish outer rootfs + inner data-root artifact
  → instantiate private clone
  → setup → Attempt
```

同一 DeploymentKey 的并发 Attempt 只产生一个 staging operation。其它 waiter 不占 Attempt concurrency。

## 重复运行

fixture、两个 archive digest、部署 recipe 与精确候选 digest 都不变时，DeploymentKey 精确命中。每个 Attempt 从 immutable artifact 创建私有 writable clone，不重新运行导入脚本。

Judge、评分或其它只影响 Attempt fingerprint 的输入变化可以让 Attempt 重跑，但不会改变 DeploymentKey。cache entry 已被回收或 Domain identity 改变时重新部署；产品承诺精确命中复用，不承诺永久存在。

canary tag 仍指向同一 digest 时命中。tag 更新后 package 身份查找器产出新 identity，DeploymentKey 自动 miss。作者不声明 `noCache`。

## 安全边界

只 commit outer container 会漏掉 `/var/lib/docker`，不是合法 Deployment artifact。在运行中的 dockerd 上复制 data-root 也可能捕获不一致 metadata。Provider 必须先 quiesce，再原子捕获 schema 声明的全部存储面，并在 clone 上重建实例 identity、启动 daemon、完成 ready 检查命令。

任一 clone 获得私有 writable storage。Attempt 不能直接挂载 staging volume，也不能共享另一个 Attempt 的 upperdir。
