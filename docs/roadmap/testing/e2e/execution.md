# 本地、Docker 与 GitHub Actions

本地和 CI 必须调用同一个根 runner。Actions 不是第二份 E2E 实现，Docker 也不是默认套在所有测试外的仪式。

## 目标命令

```sh
# 本地默认：无密钥 PR 集合
pnpm e2e --lane pr

# 按 Repo / executor / 原生测试参数收窄
pnpm e2e --repo report
pnpm e2e --repo report --executor docker
pnpm e2e --repo report -- --run test/exported-targets.test.ts

# 显式 live；缺 secret 在 prepare 前一次列清
pnpm e2e --lane main --repo adapter/codex-cli

# 本地无密钥 adapter transport / fault；与 live Repo 分开选择
pnpm e2e --lane pr --repo adapter/local-protocol
```

内部可以拆成 `pack`、`plan`、`run` 三个子动作供 CI 分布式执行；本地默认命令包装同一实现：

```sh
pnpm e2e pack --out artifacts/niceeval-candidate.tgz
pnpm e2e plan --lane pr --json
pnpm e2e run --candidate artifacts/niceeval-candidate.tgz --repo report
```

`plan --json` 只输出 Repo、executor、能力和分片，不包含产品断言。

## 一次运行

```text
discover → select → pack → isolate → install → prepare → test → collect → cleanup → summarize
```

| 阶段 | Owner | 失败输出 |
|---|---|---|
| discover / select | 根 runner | manifest 路径、lane、为何选择 / 排除 |
| pack / install | 根 runner | tarball digest、lockfile、实际 executable 路径 |
| prepare | Repo fixture | backend、端口、容器 / 服务日志 |
| test | Vitest / Playwright | 文件、标题、argv、ProcessResult、trace |
| collect / cleanup | 根 runner + Repo | artifact 清单、脱敏、残留资源 |
| summarize | 根 runner | 状态、阶段、耗时、重现命令 |

失败、取消和 signal 都必须走 collect / cleanup。`--keep-workdir` 仅供显式本地诊断。

阶段收据保存产生结果的进程本身的 exit / signal。验证不得用 `command | head`、`command | tail` 后读取管道末端退出码；
需要裁剪控制台输出时，先把 producer 的完整 stdout / stderr 与退出状态落入 artifact，再只裁剪展示副本。Repo 启动的 view、mock、
backend、container 与 browser 都必须登记 owned handle；`finally` 做有界终止，超时后升级信号，并用 pid、端口或 provider 身份确认资源消失。

## Lane

| 触发 | Lane | Secret | 内容 |
|---|---|---|---|
| 本地默认 / `pull_request` | `pr` | 无 | unit、CLI、Report、Package、本地 host / Docker fixture |
| `push main` | `main` | GitHub Environment | PR 全集 + 便宜 live adapter smoke |
| `schedule` | `nightly` | GitHub Environment | 全 adapter、sandbox、lifecycle、平台代表 |
| release preflight | `release` | GitHub Environment | 精确待发布 tarball + blocking 矩阵 |
| `workflow_dispatch` | 显式 | 按 environment | 单 Repo / lane 复现 |

Fork 与同仓 PR 使用同一无密钥门禁。禁止用 `pull_request_target` 让 PR 代码接触 secret。

## GitHub Actions 形状

```text
package job
  └─ pack candidate.tgz + sha256，上传 artifact
             │
plan job ────┼─ e2e plan --lane <lane> --json
             │
             ▼
matrix jobs：下载同一 candidate.tgz
  └─ e2e run --candidate … --repo <matrix.id>
             │
             ▼
aggregate job：JUnit + E2E summary + artifact links
```

Workflow 只准备 Node / pnpm / Docker / browser、下发矩阵、缓存 store / image layer、上传 artifact。
它不自己改 dependency、分类错误、实现重试、决定 expected 或维护另一份 Repo 清单。

Cache key 至少区分 pnpm 版本、OS / 架构和 Docker image digest。包管理器 store 依赖自身内容寻址；PR 不使用会把
其它候选测试文件带回来的宽泛 restore key。Nightly 定期跑 cold cell，防止日常 cache 掩盖缺失依赖或镜像初始化问题。

PR path filter 来自 manifest `paths`，只是省时提示：plan 无法可靠求 diff、共享 runner / package 入口变化或 manifest 自身变化时，
运行该 lane 全集。Release 不用 path filter。

## Docker

使用 Docker 的合理原因：

- 固定 Linux / 系统包 / 浏览器运行条件；
- 启动被测服务、sandbox 或多容器网络；
- 验证 host 无法表达的进程、用户、PATH、signal 或文件权限边界。

纯 Node CLI / Package Repo 默认 host，减少构建和调试成本。Repo 声明 Docker 后，本地缺 daemon 是配置错误，不能静默 fallback 到 host。

镜像使用不可变 digest；需要从本仓库构建时，Dockerfile 和 build context 进入 Repo `paths`。容器不读取宿主 secret 文件，
不挂载可写源码树，资源名带 run ID，cleanup 后检查 orphan。

## 并发

- 无密钥 host Repo 可按 CPU 并行，每个 Repo 独立副本；
- Docker Repo 按 runner CPU / memory 设置 `max-parallel`；
- live provider 按 provider / account 建 concurrency group，避免同一配额互相制造 429；
- lifecycle 串行，防止兄弟任务污染 orphan / 下一次消费者判断；
- 同一个 Repo 内会修改当前结果的测试不并发，共享证据只能在冻结后只读并发。

## 重试

只有结构化确认的 infrastructure 失败可以在**新副本**重试一次，例如 provider 明确 429 / 5xx、网络断开、GitHub runner 或
Docker daemon 故障。以下情况不重试：断言失败、测试超时、parse 失败、cleanup 失败、缺 secret / runtime。

重试摘要保留第一次失败，不能只展示最终绿色；同一个断言第二次碰巧过仍需标记 flaky regression。

候选注入失败要再分一层。runner 没把指定 tarball 注入进去，或 digest / 实际 executable 身份不一致，属于 harness failure。
候选已经正确注入，但它的 package metadata、exports、bin 或安装脚本让真实项目不可消费，属于 product regression。
两类都不得判绿；只有前者在确认临时 runner / registry 故障时才可能按 infrastructure 重试。

## Artifact 与脱敏

成功保留摘要和 JUnit；失败额外保留：

- manifest、Repo ID、lane、candidate digest、executor / backend 身份；
- argv、cwd、exit / signal、stdout / stderr 完整文件；
- browser trace、screenshot、HTML、network log；
- Docker / service log、容器检查与 cleanup 收据；
- live adapter 上游版本、模型 / CLI 身份和结构化错误。

收集后先按 runner 注入的 secret 值精确脱敏，再上传。Artifact 不能包含工作区通用 `.env`、认证目录或未筛选的 home。

## Release 信任链

Release job 先按最终版本生成 tarball 与 digest，所有 release Repo 安装该 artifact；通过后发布同一文件。
任何重新 pack、identity 不一致、blocking Repo 没有 pass / fail 状态或 artifact 丢失都阻止发布。

这保证“CI 测过的代码”和“registry 收到的包”是同一字节，而不是两个相近 checkout。

## 待测包与 CI 闭包

- 确定性 Report tests 不声明真实模型 secret，并进入 fork-safe 的无密钥 PR lane。
- Release preflight 聚合同一 tarball 的全部 blocking Repo；通过后发布同一字节与 digest。
- Manifest 的每个 artifact pattern 都由收集器契约测试证明，嵌套 glob 与空匹配行为不能依赖 workflow 猜测。
- 注入身份核验失败与待测包不可消费使用不同失败分类，并保留各自的原始收据。
- Adapter 与 Report Repo 使用原生测试文件和标题分片，不把多个命题压进线性脚本。
- CLI、Report、Package 与 live Adapter 共用根 runner 的 pack → plan → run → artifact 链；workflow 不复制选择或注入逻辑。
