# Docker profile 资产清单被误当成 profile descriptor

## 现象

新版 Docker profile host package 按部署文档把 `assets-v1.json` 放进
`/etc/niceeval/docker-profiles/`。安装后的 `niceeval docker profile doctor <alias> --json`
却在第一个 `descriptor` check 失败，并把资产清单报告为 alias `assets-v1`：

```text
Docker profile alias "assets-v1": profile.platform is unexpected
```

同一 registry 被 `niceeval exp` 读取时也会在任何 build、container 或 Attempt 开始前失败。

## 根因

宿主部署契约把 `<alias>.json`、`*.host.json`、`*.daemon.json` 与版本化 `assets-vN.json`
放在同一目录。Node registry loader 只排除了 host 与 daemon 文件，仍把每个其它 `.json`
交给 profile schema。因此 host package 新增的资产清单与客户端发现规则互相冲突。

同一轮还发现 Nix host package 的安装说明公开了
`niceeval-docker-profile-preload-verify-assets`，derivation 却没有安装对应 Python helper 与 binary。
这会让管理员无法按随包说明完成固定镜像的离线预载验证。

## 修法与长期不变量

- profile registry 只把 descriptor 候选交给 profile schema；`*.host.json`、`*.daemon.json` 与
  `assets-vN.json` 是保留的宿主部署材料，发现时忽略。
- 资产清单可以与 `<alias>.json` 并存，不占用 alias，也不能让无关 profile 失效。
- host package 安装 `preload-verify-assets` helper，并提供安装说明声明的
  `niceeval-docker-profile-preload-verify-assets` binary。
- doctor 继续从 watchdog 的 attested status 验证资产，不从 registry 拉取或修改镜像。

## 回归 kill 收据

加强既有 lifecycle owner `e2e/lifecycle/test/docker-profile-cold-build.test.ts`：隔离消费容器按真实
host package 布局，把 descriptor 与 `assets-v1.json` 一起安装到 root-owned registry，再从安装后
CLI 运行 doctor 与 cold-build experiment。

旧候选 source HEAD `55483c0a6`，tarball SHA-256
`93413100f611512db3f28ac278156a65cfea2893ba125b53f41ec9d957bb76cf`。命令：

```sh
PATH=/nix/store/0rw27f8ism3y0hyqpcnhsd49h9a9xadf-quota-4.11/bin:$PATH \
pnpm e2e run \
  --candidate /tmp/niceeval-e2e-artifacts-wksYAo/candidate/niceeval-candidate-93413100f611512db3f28ac278156a65cfea2893ba125b53f41ec9d957bb76cf.tgz \
  --repo lifecycle -- \
  --run test/docker-profile-cold-build.test.ts \
  -t 'profile-bound Dockerfile cold build starts the Attempt through the public CLI'
```

收据位于 `/tmp/niceeval-e2e-artifacts-P3zv8M/lifecycle/receipt.json`。最早失败阶段是公开 doctor 的
`descriptor` check；`control` 及之后的 check 全部为 `PREREQUISITE_FAILED`，没有发生 provider side effect。
