# Docker 镜像与构建缓存无退役机制,磁盘被历史代产物吃满

**现象**(2026-08-04,terminal-bench 全量场景):宿主盘 916G 用掉 738G。`docker system df`:镜像 612 个 436.5GB(`niceeval-build:*` 226 个 + `niceeval-agent:*` 243 个,单个 0.9~6.4GB),BuildKit 构建缓存 1464 条 292.3GB。`.niceeval/` 记录只有 243M。

**根因**:构建复用方向是好的(BuildKey 命中即复用镜像),但反方向缺失——BuildKey 因 Dockerfile/context 迭代换代后,旧代 `niceeval-build` / `niceeval-agent` 镜像与构建缓存永不回收。`niceeval sandbox prune` 只回收容器实例,不管镜像;NiceEval 创建镜像却不管理镜像生命周期。几天内两三代 × 238 题就是数百 GB。

**修法(候选上游 feature,未实现)**:

1. 自建镜像打 label(build-key、eval id、构建时间);新增 `niceeval gc`(或扩展 `sandbox prune`)按「不被当前任何 experiment 的 BuildKey 引用」精确回收旧代镜像,顺带按水位 `docker builder prune`。
2. provisioning 前磁盘水位 fail-fast,不足即报错并提示 gc 命令,不要构建到一半 no space 产出成批 errored。
3. 官方共享 base image + runner 工具烘焙,减小每题镜像独立层(同时解决每 sandbox 重复安装工具的并发 OOM 诱因)。

**临时处置**:run 结束后手工清理——从记录提取本轮实际使用的镜像 tag 集合,保留后删其余 `niceeval-*` 镜像,再 `docker builder prune --keep-storage <N>`。
