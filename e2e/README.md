# E2E 场景 Repo

正式设计见 [`docs/engineering/testing/e2e/README.md`](../docs/engineering/testing/e2e/README.md)。本目录只说明当前可运行入口；测试契约、owner 与写法不在这里复制。

## 目录

每个带 `e2e.json` 的叶子目录都是一个独立消费项目，自带 `package.json`、lockfile 和原生 Vitest或 Playwright 测试。根 runner 把候选 `niceeval` tarball 安装进仓库外副本，再执行 manifest 声明的命令。

```text
e2e/
├── cli/                    # argv、机器输出、失败分类与缓存
├── runner/                 # carry、history 与确定性调度
├── package/                # ESM、CJS、exports 与外部 cwd
├── record/                 # 公开 niceeval/record 写读边界
├── report/                 # show、view、导出与浏览器 Journey
├── lifecycle/              # signal、资源终结与下一消费者
├── adapter/
│   ├── local-protocol/     # 无密钥 transport 与可控故障
│   └── <id>/               # 每个真实 SDK / CLI / provider 一个 live Repo
├── scripts/                # 发现、计划、pack、注入、执行、收据与 artifact
└── undo/                   # 未启用历史 fixture；没有 e2e.json，不参与发现
```

目录结构本身不决定测试身份；`e2e.json.id` 才是稳定 Repo id。`adapter/` 只是物理 collection，不提供共享依赖或共享结果根。

## 根入口

```sh
pnpm e2e plan --lane pr --json
pnpm e2e pack --out-dir /tmp/niceeval-candidate
pnpm e2e run --candidate /tmp/niceeval-candidate/<tarball> --repo cli

# 默认模式依次 plan → pack 一次 → 对选中 Repo 运行同一 tarball
pnpm e2e --lane pr
pnpm e2e --repo report -- --run test/report.test.ts
pnpm e2e --repo report -- --run test/report.browser.spec.ts -t "打开"
```

本地开发未发布的 Testkit 时，显式注入一次打包结果：

```sh
pnpm e2e run \
  --candidate /tmp/niceeval-candidate.tgz \
  --testkit packages/testkit/artifacts/niceeval-testkit-0.1.0.tgz \
  --repo cli
```

`--testkit` 只用于本地验证；场景 Repo 的 `package.json` 始终声明 registry 精确版本。最终产品 gate 不注入本地 Testkit。

## 选择与失败

- `plan` 只读 manifest，不 pack、不安装、不读取 secret。
- `run` 在临时副本依次执行 install、injection attestation、test、artifact collection 与 cleanup。
- 选择使用 `--lane`、`--repo`、`--path` 和 capability；不存在旧 `group` 参数。
- 测试非零退出归 regression；安装、注入、artifact 或 cleanup 失败归 infra。Adapter 不用 exit 75 或日志正则猜分类。
- 原始收据、JUnit 与声明的 artifact 写入 durable artifact root；隔离副本在 cleanup 阶段删除。

## 单项调试

正式验收始终走根 runner，确保 candidate 与 Testkit 身份可核对。进入叶子目录直接运行 `pnpm e2e` 只适合已经安装好依赖后的测试正文调试；它不证明当前 checkout 的 candidate 已被注入。
