# Docker profile doctor 继承了 DIND 镜像的远端 DOCKER_HOST

## 现象

宿主 watchdog、journal 与固定资产升级后，`niceeval docker profile doctor harness-raw --json` 的前七项
全部 PASS，动态诊断却报告：

```text
control-owned diagnostic must emit exactly one JSON result
```

同一 digest 的最小容器复现显示，嵌套 `dockerd` 已在 `/var/run/docker.sock` 启动成功，循环中的
`docker info` 却持续连接 `http://docker:2375`，最终没有执行到 JSON 输出。

## 根因

固定 `docker:29-dind` 镜像带有 `DOCKER_HOST=tcp://docker:2375`。watchdog 的诊断脚本显式把 daemon
绑定到 Unix socket，却没有覆盖镜像环境；后续所有 `docker info`、`import`、`run`、`rm` 与 `image rm`
仍选择远端 TCP endpoint。诊断容器的隔离网络中没有名为 `docker` 的服务，因此脚本超时退出。

## 修法与长期不变量

- control-owned 诊断脚本在启动 daemon 前固定
  `DOCKER_HOST=unix:///var/run/docker.sock`；镜像默认环境不能改变 doctor 的 endpoint。
- 诊断继续检查容器内不存在 2375/2376 listener，不能为了适配镜像默认值开启 TCP daemon。
- lifecycle cold-build owner 必须包含一次未注入故障、未预占 capacity 的完整 doctor，并要求 12 项全为
  PASS；BLOCKED、只测强杀与只测 cleanup 都不能替代 happy path。

## 回归 kill 收据

既有 owner `e2e/lifecycle/test/docker-profile-cold-build.test.ts` 增加完整 doctor happy path。旧实现使用
安装后候选与真实 checkout watchdog，在前置 capacity、SIGKILL 与 fault cleanup 全部收敛后，仍在该 doctor
命令非零退出。

旧候选 source HEAD `55483c0a6`，tarball SHA-256
`ac3f22b9c075bd8d84e8ef4029046f3fee2af0d17e74d110f561bb89493d7697`。收据位于
`/tmp/niceeval-e2e-artifacts-NMt5wz/lifecycle/receipt.json`，test invocation ID 为
`6535695e-ff68-4cd9-b4f9-1a368f81f9bf`。真实宿主上的公开 doctor 同时保存了前七项 PASS、动态诊断失败的
可复现观察。
