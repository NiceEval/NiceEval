# Docker profile create 迁移只完成了宿主侧，cold build 在 Attempt 前失败

## 现象

profile-bound Dockerfile 第一次构建时，安装后的 `niceeval exp` 在 `sandbox.image.build` 失败，
公开 `niceeval show --run <run-id> --json` 显示 `sandbox-build-failed`、membership
`not-dispatched`，底层错误为：

```text
control-create-unimplemented: container create must be owned by the control service; client-supplied IDs are forbidden
```

同一时期的 `niceeval docker profile doctor <alias> --smoke` 也仍沿用客户端创建 network/container
再调用 `reservation.commit` 的旧路径。

## 根因

Docker profile control service 已经拒绝 `reservation.commit` 并接管 `container.create`，但两个公开
consumer 没有同步迁移：`sandbox/runtime.ts` 的 profile Dockerfile build 仍直接连接 daemon 创建 build
network，doctor smoke 仍直接创建 network/container。build 的 context stream、builder/network 名称、最终 tag
和终止证明也没有 durable control owner，客户端断线后宿主无法独立收敛资源。

## 修法与长期不变量

- profile Dockerfile 客户端只提交规范化 build metadata 与经过既有过滤规则的 tar stream；control service
  派生 tag、独占 network、BuildKit builder 与 operation ID，并在 durable journal 里证明 build process、builder、
  provisional ref 和 network 全部消失后才允许释放 reservation。
- profile container create 只提交无 host path、无 Docker HostConfig、无 network/container ID 的规范化请求；
  control service从 reservation 派生资源硬限额、project-quota data allocation、网络和 descriptor-pinned DNS。
- build release 不再接受客户端 `terminationEvidence`，旧 `reservation.commit` 继续 fail closed；doctor smoke
  使用同一 `container.create`，完整资源向量包含 1 GiB `ephemeralDiskBytes`。
- build context 先受 4 MiB 单帧与 2 GiB 实际接收字节硬限额约束，再逐成员拒绝绝对路径、路径穿越、重复项、
  link、device、sparse 与非 regular 类型；解包成员总量另有 2 GiB 上限。两层都 fail closed，不能只信 tar header。
- `docker-container` driver 的容器没有 reservation label，不能用 label absence 证明 builder 已消失。watchdog 必须从
  control-derived builder name 枚举 `buildx_buildkit_<builderName>0`，并精确查询其
  `buildx_buildkit_<builderName>0_state` volume。两者都要显式删除并复查，container 的 PID/start time 与 cgroup v2
  path 也必须消失；build CLI、builder metadata/container/volume、provisional image 和 network 全部消失后才能释放
  reservation，任一查询失败都 fail closed。
- committed container 的重复 create 由 host 校验相同 spec 与唯一可见资源；生产和 doctor 的 start 都先 inspect，遇到
  Docker 304 只在 fresh inspect 证明 `Running` 时接受。committed build replay 不重复执行 build。
- 客户端取消 build 时发送 `build.cancel` 后立即返回取消错误，不进入最多 30 秒的丢回复轮询；非取消的 reply loss
  仍从 durable reservation 对账。同 generation watchdog 重启会先收敛 provisioning build，无法证明资源消失时关闭
  admission 并 quarantine，不能把 active build 永久留在 provisioning。
- 新客户端的 cold-build framing 需要同版本 host package 的 `build.create` / `build.lookup`；二者必须同步部署。
  只实现 `container.create` 的 partial-migration watchdog 足以运行新版 doctor create 语义，但不能运行新版
  profile Dockerfile cold build，客户端不得 fallback 或重开 commit。

## 回归 kill 收据

既有 owner 中没有能安装 candidate 并穿过真实 profile/control service 的 cold-build 场景，因此新增 lifecycle
单边界 owner `e2e/lifecycle/test/docker-profile-cold-build.test.ts`。它安装候选 tarball，通过真实
`niceeval exp` 和真实 checkout watchdog / Docker daemon / root-owned registry+socket 运行 cold build，再由
公开 `niceeval show` 读取失败结果；核心 control service 不使用 mock。

旧候选：source HEAD `be0b98ec44a0f3ef0e159d9fff8ebb60c2a8eb38`，tarball SHA-256
`ba7b773e3f3307eaf5055fed251bd3005b59c7a3e3b47ab50f84759e5f3a5dbf`。命令：

```sh
pnpm e2e run --candidate /tmp/niceeval-fix-docker-red/niceeval-candidate.tgz --repo lifecycle --artifact-root /tmp/niceeval-fix-docker-red/artifacts-red-receipt -- --run test/docker-profile-cold-build.test.ts -t 'profile-bound Dockerfile cold build starts the Attempt through the public CLI'
```

收据在 `/tmp/niceeval-fix-docker-red/artifacts-red-receipt/lifecycle/receipt.json`；最早产品失败阶段是
`sandbox.image.build`，Attempt 尚未派发。随后发现的 `dind-image-incompatible: missing node` 是 E2E fixture
能力缺失，已由容器日志与最小只读根实验确认并修入 fixture，不属于产品红灯。
