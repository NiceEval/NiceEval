# 方案 4：Lifecycle

**相关文档**：[README](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md)

## 一次运行

```text
discover → select → pack → isolate → install → prepare → test → collect → cleanup → summarize
```

1. `discover` 只读取叶子项目的 `e2e.json`。
2. `select` 按 `--repo`、`--lane`、平台能力与变更路径选择项目。
3. `pack` 只生成一次候选 tarball，并登记 digest。
4. `isolate` 为每个项目和每次重试建立全新副本。
5. `install` 注入候选并核对实际定位身份。
6. `prepare` 启动项目拥有的本地进程、Docker service、浏览器或 live provider preflight。
7. `test` 运行项目的原生 Vitest 或 Playwright Test 命令；过滤参数原样透传。
8. `collect` 无论成功失败都收集声明的 artifact，并执行 secret redaction。
9. `cleanup` 停服务、关浏览器、删容器与临时目录；`--keep-workdir` 只供显式本地诊断。
10. `summarize` 聚合 JUnit、阶段、耗时、候选 digest 与复现命令。

## Evidence 复用

同一测试文件或同一项目运行内，可以在 `beforeAll` 生产一次昂贵证据，再由多个只读测试消费。
证据根在 prepare 结束后转成只读；需要修改结果的测试复制自己的最小写集。

第一版不跨提交复用 evidence。
跨候选缓存需要同时证明 candidate、fixture、producer、provider 与宿主身份，成本和误复用风险都高于当前收益。

## 本地

```sh
pnpm e2e --lane pr
pnpm e2e --repo cli
pnpm e2e --repo report --executor docker
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --lane main --repo adapter/ai-sdk
```

默认本地命令选择无密钥 `pr` lane。
显式选择 live 项目时，缺密钥要在启动前列出缺项与配置方式。
Docker 项目先检查 daemon、镜像 digest 与资源预算；不满足时报告 prepare 配置错误。

## GitHub Actions

| 触发 | lane | 密钥 | 目标 |
|---|---|---|---|
| `pull_request` | `pr` | 无 | unit、CLI、Report、Package、本地 Docker fixture |
| `push main` | `main` | GitHub Environment | PR 全集 + 便宜 live adapter smoke |
| `schedule` | `nightly` | GitHub Environment | 全 adapter、sandbox、cleanup、平台代表 |
| 手动完整验收 | `release` | GitHub Environment | 按需复现完整矩阵，不参与发布门禁 |
| `workflow_dispatch` | 显式 | 按 environment | 单 repo / lane 复现 |

PR 代码绝不通过 `pull_request_target` 获取 secrets。
fork 与同仓 PR 使用完全相同的无密钥门禁。

workflow 的职责只有 checkout、运行时准备、矩阵调度、缓存 store / image layer、调用根命令和上传 artifact。
项目选择、候选注入、executor、退出码分类与一次重试全部由根编排器拥有，本地和 CI 不分叉。

## 并发与重试

- 无密钥 host 项目可并行；每个项目独立临时目录。
- Docker 项目按 runner CPU / memory 限制 `max-parallel`。
- live provider 按 provider / account 建 concurrency group，避免同一配额互相制造 429。
- lifecycle 项目串行，确保 orphan 与下一次消费者的判断不被兄弟任务污染。
- 只有确证 infrastructure 的运行重试一次；断言失败、超时和 cleanup 失败不重试。

## Release

release workflow 先按 tag 生成带最终版本的 tarball 并保存 digest，publish job 复核并发布同一 artifact，不运行 release lane。
日常与手动 E2E 保持独立；其 live provider 结果不延迟或阻止发布。
artifact 丢失、digest 或 npm identity 不一致仍阻止发布。
