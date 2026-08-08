# 本地、Docker 与 GitHub Actions

本地和 CI 必须调用同一个根 runner。Actions 不是第二份 E2E 实现，Docker 也不是默认套在所有测试外的仪式。

根 runner 不建立一套与真实场景平行的模拟系统，也不拥有 `test/unit/e2e-runner/`。发现、选择、注入、安装、收据和 cleanup
通过真实 Repo 与根 CLI 运行验收；workflow 的发布顺序由真实 preflight / release 和 review 验收，不用 Vitest 对 YAML 或源码文本做 syntax parse。

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
pnpm e2e run --candidate artifacts/niceeval-candidate.tgz --repo report --artifact-root artifacts/e2e/report
```

- `plan --json` 只输出 Repo、executor、能力和分片，不包含产品断言；
- 本地默认顺序是 plan → pack NiceEval candidate → run；
- `run` 在选中 Testkit consumer 时 clean-build 当前 workspace Testkit 一次；
- 无 Repo 被选择或 manifest 非法时不 pack、不 build；
- CI 的 prepare job 先 plan，只在选中 Repo 后测试 Testkit 并 pack 一次 candidate；
- matrix run 消费 candidate artifact 与当前 checkout，不再下载第二份 Testkit artifact；
- `plan` 不 pack、不安装、不读 secret、不创建 Repo 副本；显式 `run --candidate` 不重新 pack。

Candidate 就是当前 checkout 当场生成的待发布字节，不是 registry 上另一个版本。NiceEval 不能改用 workspace link：link 会绕过
`files`、打包生命周期、bin / exports 完整性和仓库外 dependency resolution，可能让源码树能跑而实际安装包失败。Testkit 没有这些发布承诺，
所以直接采用 checkout 目录。

`run --artifact-root` 让 CI 指定独立于临时工作副本的证据根；runner 删除副本后保留其中的 `summary.json`、Repo receipt 与声明附件。
原生测试参数在 `--` 后原样且只传一次。

## Owner 接管运行

新增、接管或实质修改 owner 时，根 runner 保留一组可审查的接管收据：

1. 同一 candidate 与 checkout Testkit 在三个全新 Repo 副本中各运行目标 owner 一次；
2. 另一个副本连续运行目标 owner 两次，不重置它不拥有的外部状态；
3. 所属 Repo 用默认并行完整运行一次；
4. 目标 owner 按文件和标题单项运行一次；
5. 每次运行都核对进程、server、container、Sandbox 和临时副本的资源终态。

接管运行固定 candidate digest、checkout commit、lockfile、fixture、seed、时钟策略和运行镜像。
所有运行必须得到相同语义 Verdict 与实体关系；动态 ID、临时端口和 duration 不要求逐字相同。
接管运行禁用测试级 retry，任一次意外失败都不合格。普通 lane 的 Infrastructure retry 不能替代这份可靠性证据。

### Testkit 构建与注入

`pnpm e2e --repo <id>` 在选中 `harness.testkit: true` Repo 后，自动删除当前 checkout 的 Testkit `dist/` 并完整构建，
每次 invocation 只做一次。Testkit 没有 CLI artifact 参数，也不参与 candidate 的发布信任链。

- runner 校验 workspace package 名为 `@niceeval/testkit` 且保持 private，并确认 clean build 产出了 ESM、CJS 与类型入口。
- 注入只在隔离副本的 devDependencies 中新增指向 `packages/testkit` 绝对目录的 `file:`，不写源 Repo。未声明
  `harness.testkit: true` 却 import Testkit，或声明了但没有注入，都在 test 前失败。
- 安装后要求副本 lockfile 只有一个 Testkit directory resolution，再核对实际安装包名与 realpath 位于副本 virtual store。
  不一致属于 harness failure（infra），不静默链接回 checkout source 或安装其它版本继续跑测试。
- receipt 只保存 version、checkout 相对 source path 与副本内 installed realpath，全部仅供诊断。durable artifact 与 exact replay
  只属于 NiceEval candidate；重跑时 Testkit 始终来自当时所在 checkout。

功能 Repo 与 Adapter Repo 永远是不同的 matrix cell。`--repo report` 只复制并运行 Report 功能 Repo，不会挑一个
`adapter/ai-sdk` Repo 来提供“更真实”的模型结果；`--repo adapter/ai-sdk` 也只运行该兼容性项目。`main` / `release` lane
可以同时选择两组 Repo，但它们仍分别安装、执行、收集 artifact 和 cleanup。

## 一次运行

```text
discover → select → pack candidate → build Testkit → isolate → prepare/inject → install/attest → test → collect → cleanup → summarize
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

每次安装核对 NiceEval candidate 字节身份，并核对 Testkit 来自当前 checkout 的目录 resolution 与副本内安装路径。
Testkit 以 typecheck、clean build 和真实产品场景中的使用结果验收；它不保留独立 Unit，也不获得第二份 artifact 身份。

阶段收据保存产生结果的进程本身的 exit / signal。验证不得用 `command | head`、`command | tail` 后读取管道末端退出码；
需要裁剪控制台输出时，先把 producer 的完整 stdout / stderr 与退出状态落入 artifact，再只裁剪展示副本。Repo 启动的 view、mock、
backend、container 与 browser 都必须登记 owned handle；`finally` 做有界终止，超时后升级信号，并用 pid、端口或 provider 身份确认资源消失。

## Lane

| 触发 | Lane | Secret | 内容 |
|---|---|---|---|
| 本地默认 / `pull_request` | `pr` | 无 | unit、CLI、Runner、Report、Package、本地 host / Docker fixture |
| `push main` | `main` | GitHub Environment | PR 全集 + 低成本 live Adapter 兼容性检查 |
| `schedule` | `nightly` | GitHub Environment | 全 adapter、sandbox、lifecycle、平台代表 |
| release preflight | `release` | GitHub Environment | 精确待发布 tarball + 确定性 blocking 矩阵 + live 结果或 AI 真实验收 |
| `workflow_dispatch` | 显式 | 按 environment | 单 Repo / lane 复现 |

Fork 与同仓 PR 使用同一无密钥门禁。禁止用 `pull_request_target` 让 PR 代码接触 secret。
任何会实际调用付费模型的 live 验收、批量 Adapter 矩阵或整批重跑，都必须先取得用户明确批准；lane 选择与 secret 可用不构成授权。

## GitHub Actions 形状

```text
prepare job
  ├─ e2e plan --lane <lane> --json
  ├─ Testkit typecheck / clean build
  └─ pack candidate.tgz + sha256，上传 artifact
             │
             ▼
matrix jobs：下载同一 candidate.tgz
  └─ checkout 中 build Testkit；e2e run --candidate … --repo <matrix.id>
```

Workflow 只准备 Node / pnpm / Docker / browser、下发矩阵、缓存 store / image layer、上传 artifact。
它不自己改 dependency、分类错误、实现重试、决定 expected 或维护另一份 Repo 清单。
每个 matrix cell 自己上传 receipt、summary、JUnit 与声明附件；GitHub 原生汇总 matrix 成败，不再启动一个 job
下载并复述所有 cell 的结果。

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
- Repo 内保留 Vitest / Playwright 的默认文件级并行；短命控制文件、结果根、项目副本与资源名按 case 隔离；
- Docker Repo 按 runner CPU / memory 设置 `max-parallel`；
- live provider 按 provider / account 建 concurrency group，避免同一配额互相制造 429；
- Lifecycle case 用独立进程组、动态端口和 run ID 核对自己的 orphan，不得因兄弟任务存在就误判；
- 共享 evidence 只能在冻结后只读并行。无法拥有独立资源的 case 才局部串行，不把整个 Lifecycle 域降为串行。

## 重试

只有结构化确认的 infrastructure 失败可以在**新副本**重试一次，例如 provider 明确 429 / 5xx、网络断开、GitHub runner 或
Docker daemon 故障。以下情况不重试：断言失败、测试超时、parse 失败、cleanup 失败、缺 secret / runtime。

重试摘要保留第一次失败，不能只展示最终绿色；同一个断言第二次碰巧过仍需标记 flaky regression。
Owner 接管运行完全禁用重试。普通 lane retry 后转绿也不能计入可靠性验收。

候选注入失败要再分一层。runner 没把指定 tarball 注入进去，或 digest / 实际 executable 身份不一致，属于 harness failure。
候选已经正确注入，但它的 package metadata、exports、bin 或安装脚本让真实项目不可消费，属于 product regression。
两类都不得判绿；只有前者在确认临时 runner / registry 故障时才可能按 infrastructure 重试。
Testkit directory resolution、包身份或实际安装路径不符合当前 checkout 同样属于 harness failure。

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

确定性协议 counterpart 阻断产品 regression。有效 live Adapter 结果显示协议不兼容时同样阻断。
结构化外部故障不是 pass，但可以由同一 candidate 的 AI 真实兼容性验收替代。
PR / release 说明必须保存版本、生产入口、动作、公开观察与未守护风险。
既没有有效 live 结果，也没有本次 AI 真实验收时，该兼容性状态是“未证明”，不能伪装成通过。

Release Repo 使用同一 checkout 的私有 Testkit 作为 harness，但只有 NiceEval candidate 进入 pack-once、digest、preflight 与 publish
信任链。安装后的 candidate 必须证明不包含、也不依赖 `@niceeval/testkit`。

这保证“CI 测过的代码”和“registry 收到的包”是同一字节，而不是两个相近 checkout。

## 待测包与 CI 闭包

- 确定性 Report tests 不声明真实模型 secret，并进入 fork-safe 的无密钥 PR lane。
- Release preflight 聚合同一 tarball 的全部 blocking Repo；通过后发布同一字节与 digest。
- 注入身份核验失败与待测包不可消费使用不同失败分类，并保留各自的原始收据。
- Adapter 与 Report Repo 按 owner 拆成原生测试文件，再按文件和标题分片；不把多个命题压进线性脚本或同一文件。
- CLI、Runner、Report、Package 与 live Adapter 共用根 runner 的 pack → plan → run → artifact 链；workflow 不复制选择或注入逻辑。
- 共用 runner 不等于共用 Repo；功能与 Adapter 始终是不同 matrix cell、依赖安装和结果根。
