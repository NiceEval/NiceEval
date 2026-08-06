# CLI scenario repo

这是无密钥、可放进 PR lane 的真实消费项目。根 runner 在临时副本中把 `niceeval` 改指候选 tarball 后运行
`pnpm test`；测试正文直接展示完整 `pnpm --silent exec niceeval …`、exit、stdout、stderr、JSON / NDJSON 与
pipe 尾部 sentinel。它不读取 `.niceeval/` 私有文件。

正式落入 `e2e/cli/` 时由 `pnpm install` 生成并签入 lockfile；本设计样例不手写一份伪 lockfile。

```sh
# NiceEval 根目录
pnpm e2e --repo cli -- --run test/cli-results.test.ts

# 已安装候选包的隔离 Repo 根目录
pnpm test --run test/cli-results.test.ts
```
