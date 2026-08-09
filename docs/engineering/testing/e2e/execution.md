# 本地、Docker 与 GitHub Actions

本地和 CI 必须调用同一个根 runner。Actions 不是第二份 E2E 实现，Docker 也不是默认套在所有测试外的仪式。

根 runner 不建立一套与真实场景平行的模拟系统，也不拥有 `test/unit/e2e-runner/`。发现、选择、注入、安装、收据和 cleanup
通过真实 Repo 与根 CLI 运行验收；workflow 的发布顺序由真实 preflight / release 和 review 验收，不用 Vitest 对 YAML 或源码文本做 syntax parse。

## 目标命令

```sh
# 本地默认：无密钥 PR 集合
pnpm e2e --lane pr

# 按 Repo / 原生测试参数收窄
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts

# 显式 live；缺 secret 在 prepare 前一次列清
pnpm e2e --lane main --repo adapter/codex-cli

# 本地无密钥 adapter protocol / transport / fault；与 live Repo 分开选择
pnpm e2e --lane pr --repo adapter/local-protocol
```

本地运行只从仓库根目录的 `.env` 读取私有凭据与宿主浏览器路径；各功能 Repo / Adapter Repo 不保存自己的 `.env`。
根 runner 在 `plan` 与 `pack` 阶段不读取该文件，只在真正进入 `run` 时加载一次，并继续按各 Repo manifest 的
`secrets` 白名单做最小注入。复制根目录 `.env.example` 后即可直接执行上述命令；CI 仍由 workflow 注入同名变量。

内部可以拆成 `pack`、`plan`、`run` 三个子动作供 CI 分布式执行；本地默认命令包装同一实现：

```sh
pnpm e2e pack --out artifacts/niceeval-candidate.tgz
pnpm e2e plan --lane pr --json
pnpm e2e plan --lane release --no-diff --json
pnpm e2e run --candidate artifacts/niceeval-candidate.tgz --repo report --artifact-root artifacts/e2e/report

# Owner 接管可靠性收据：target 必须在 -- 后给出原生文件/标题参数
pnpm e2e takeover --candidate artifacts/niceeval-candidate.tgz --repo report \
  --artifact-root artifacts/e2e/takeover-report -- --run test/report.browser.spec.ts -t "打开"

# 仅本地结构化 release 核验；不发布、不调用 workflow 产品逻辑
pnpm e2e verify-release --plan artifacts/release-plan.json \
  --candidate artifacts/niceeval-candidate.tgz --receipt-root artifacts/e2e/release --tag v0.4.6
```

- `plan --json` 只输出 Repo、host executor、能力和分片，不包含产品断言；
- 本地默认顺序是 plan → pack NiceEval candidate → run；
- 默认入口只生成一次 plan，并把该 plan 的精确 Repo ID 集传给 run；隐式 dirty diff 也不会在 run 时扩大选择；
- `run` 在选中 Testkit consumer 时 clean-build 当前 workspace Testkit 一次；
- 无 Repo 被选择或 manifest 非法时不 pack、不 build；
- CI 的 prepare job 先 plan，只在选中 Repo 后测试 Testkit 并 pack 一次 candidate；
- matrix run 消费 candidate artifact 与当前 checkout，不再下载第二份 Testkit artifact；
- `plan` 不 pack、不安装、不读 secret、不创建 Repo 副本；显式 `run --candidate` 不重新 pack。

`verify-release` 只接受非空的 `plan --json` 数组、candidate `.tgz`、receipt root 与 tag。
它要求 receipt 的 Repo ID 与 plan 精确且唯一对应，并且全部为 `pass`。
每格的 sha256/SRI 必须等于 candidate；receipt 保留的 tarball 也必须字节同 digest。
它从 tarball 的 `package/package.json` 核对 `niceeval`、版本与精确 `v<version>` tag。
该命令不重新 pack、不发布，也不把判断放进 workflow。

Candidate 就是当前 checkout 当场生成的待发布字节，不是 registry 上另一个版本。NiceEval 不能改用 workspace link：link 会绕过
`files`、打包生命周期、bin / exports 完整性和仓库外 dependency resolution，可能让源码树能跑而实际安装包失败。Testkit 没有这些发布承诺，
所以直接采用 checkout 目录。

`run --artifact-root` 让 CI 指定独立于临时工作副本的证据根；runner 删除副本后保留其中的 `summary.json`、Repo receipt 与声明附件。
原生测试参数在 `--` 后原样且只传一次。
durable root 先物理锚定，系统级父目录 symlink 可以归一化。root 自身及其以下每层都必须是实目录。
candidate、receipt 与 summary 在读写前拒绝 root 内的 symlink。
`verify-release` 读取保留 tarball 时也做同一目录链核验。

## Owner 接管运行

新增、接管或实质修改确定性 owner 时，必须使用根入口 `pnpm e2e takeover --candidate ... --repo <id> -- --run <file> -t <title>`。
它拒绝没有显式 candidate、Repo 或原生 target 参数的调用；不是把普通 `run` 重复五次冒充可靠性门。
接管入口先固定 candidate digest、checkout commit/dirty 标记、一次 Testkit clean build（如需要）与场景源 snapshot，再保留以下可审查 receipt：

1. 同一 candidate 与 checkout Testkit 在三个全新 Repo 副本中各运行目标 owner 一次；
2. 另一个**同一已安装副本**连续运行目标 owner 两次；它只 install 一次，两个 native test command 各有新的 `NICEEVAL_E2E_INVOCATION_ID`，不能因 `stageArtifacts` 的 `collision:error` namespace 假红；
3. 所属 Repo 用默认并行完整运行一次；
4. 目标 owner 按文件和标题单项运行一次；
5. 每次运行都核对进程、server、container、Sandbox 和临时副本的资源终态。

接管 summary 的每项链接到独立 receipt；same-copy receipt 含两个 test stage、按 attempt 显式关联的两个 invocation ID 和一个 copy ID。它不 retry：重复是明确的观察矩阵，
不是用第二次通过掩盖第一次失败。接管运行固定 candidate digest、checkout commit、lockfile、fixture、seed、时钟策略和运行镜像。
所有运行必须得到相同语义 Verdict 与实体关系；动态 ID、临时端口和 duration 不要求逐字相同。
接管运行禁用测试级 retry，任一次意外失败都不合格。普通 lane 的 Infrastructure retry 不能替代这份可靠性证据。

真实 provider live owner 不进入这套重复矩阵：每次新增或实质修改做一次已明确授权的真实运行，并完成 `show` / history /
execution 等公开 readback。只有用户另外授权明确调用次数 / 成本时才对 live Repo 执行 takeover；provider 随机性不能充当产品可靠性证据。

source snapshot 包含会进入副本的未忽略 untracked 文件。runner 拒绝 symlink 与特殊文件。
summary 写入按相对路径、字节数和 SHA-256 排序所得的文件清单与总 digest。
每份 takeover receipt 都带同一 digest；矩阵核验会拒绝缺失或不一致的绑定。
它还核验六个标签、copy ID、native argv、attempt 数、唯一 invocation ID、candidate 身份和每份 cleanup 终态。

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
discover → select → pack candidate → build Testkit → capability preflight → isolate → prepare/inject → install/attest → browser preflight → test → collect → cleanup → summarize
```

| 阶段 | Owner | 失败输出 |
|---|---|---|
| discover / select | 根 runner | manifest 路径、lane、为何选择 / 排除 |
| pack / install | 根 runner | tarball digest、lockfile、实际 executable 路径 |
| prepare | Repo fixture | backend、端口、容器 / 服务日志 |
| test | Vitest / Playwright | 文件、标题、argv、ProcessResult、trace |
| collect / cleanup | 根 runner + Repo | artifact 清单、脱敏、残留资源 |
| summarize | 根 runner | 状态、阶段、耗时、重现命令 |

每个 Repo invocation 注入新的非秘密 `NICEEVAL_E2E_INVOCATION_ID`；receipt 只写 ID，不写 secret 值。

`requires.runtimes`、`requires.docker`、`requires.browsers`、平台与 manifest secret 都在 test 前形成结构化 capability check。
缺 runtime、Docker daemon、browser 或显式需要的 secret 是 `configuration`，不是 regression。
`externalNetwork: true` 也会写入结构化 check，但其状态是“声明但未预检”。
runner 不对任意公网 endpoint 做伪探测；真实 owner test 验证自己的 provider/network 边界。

子进程从普通运行变量开始。runner 会剥离未由该 Repo 声明的敏感名变量。
敏感名包含 token、key、secret、password、credential、auth 与 jwt 的分段或常见复合写法，也包含数据库连接变量。
preflight、install 与 test 使用同一规则；receipt 只写变量名与可用性，不写值。

失败、取消和 signal 都必须走 collect / cleanup。顶层 CLI 只安装一次 SIGINT/SIGTERM 状态机。
第一次停止新阶段，并向活跃的**已拥有进程组**转发同一 signal。经过 grace 后发送 KILL。
runner 等待 child `close`，再确认该 owned group 已消失；若 leader 已退出而 group 仍在，也执行 TERM、grace 与 KILL。
每个 command capture 写入 groupCleanup 结果，包含探测、信号与终态。

第二次 signal 立即 KILL 已拥有组。SIGKILL 不可捕获，因此不承诺其后的 receipt 或 cleanup。
runner 只承诺自己 detached group 内无 orphan。
container、Sandbox 或场景另开 session 仍由所属 Repo 的资源 receipt 负责。`cancelled` 永不改报为 regression。
`--keep-workdir` 仅供显式本地诊断。

根 runner 先完成 scratch cleanup，再写最终 summary。scratch cleanup 失败是 `infra` 并使命令非零。
若已经有 artifact root，discover、build 或其它根异常也尽力写入该终态。
最终 summary 无法写入时，除 cancelled 外命令也必须非零。
已有 regression 或 cancelled 仍是主分类，runner cleanup 失败附在终态字段中。

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
可信 lane 的 workflow 只能显式引用已登记的 secret 白名单；禁止 `toJSON(secrets)` 或其它全量枚举。
Repo manifest 声明了白名单外的名称时，在注入前失败，不动态读取其它仓库 secret。
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

PR path filter 来自 manifest `paths`，只是省时提示。显式 `--repo` 永远不受 diff filter 排除。
plan 无法可靠取得 diff、共享 runner/package 入口变化或 manifest 自身变化时，执行该 lane 全集。
候选包的以下输入变化也执行整条 lane：

- `bin/**`、`scripts/package-runtime/**`、`scripts/generate-reference.ts`、`INDEX.md` 与 `INDEX.template.md`；
- `docs-site/zh/**`、`docs-site/images/**` 与 `dist/**`；
- root `.npmrc`、`.npmignore`、`.gitignore`、自动纳入文件、pnpm 配置、package metadata 与 root tsconfig。

本地 diff 同时读取 tracked 改动和未忽略 untracked 路径。多个显式 Repo 中有任一不属于 lane 时，plan 失败，不能静默删掉它。
Release 固定传 `--no-diff`，不用 path filter；`--no-diff` 与显式 `--diff-path` / `--diff` 同时出现时属于配置错误。

## Docker

使用 Docker 的合理原因：

- 固定 Linux / 系统包 / 浏览器运行条件；
- 启动被测服务、sandbox 或多容器网络；
- 验证 host 无法表达的进程、用户、PATH、signal 或文件权限边界。

纯 Node CLI / Package Repo 默认 host，减少构建和调试成本。当前 manifest executor 只有 `host`；需要 Docker sandbox / backend 的 Repo 使用
`requires.docker: true`。本地缺 daemon 是配置错误，不能静默 fallback 或把 host 伪装成 Docker executor。

镜像使用不可变 digest；需要从本仓库构建时，Dockerfile 和 build context 进入 Repo `paths`。容器不读取宿主 secret 文件，
不挂载可写源码树，资源名带 run ID，cleanup 后检查 orphan。

Live Adapter 的每个 `dockerSandbox()` 都显式声明 2 CPU、512 PID 与零额外 swap。常规 CLI 场景的 memory hard limit 是
3 GiB；Claude Code 的 plugin / skill 并行场景实测会击穿 3 GiB，因此单独使用 4 GiB。额度属于 Sandbox template，必须由
Docker cgroup 的 `cpu.max`、`memory.max`、`memory.swap.max` 与 `pids.max` 验收，不能只检查 TypeScript 声明或 Docker inspect。

## 并发

- 无密钥 host Repo 可按 CPU 并行，每个 Repo 独立副本；
- Repo 内保留 Vitest / Playwright 的默认文件级并行；短命控制文件、结果根、项目副本与资源名按 case 隔离；
- 使用 Docker backend 的 Repo 按 runner CPU / memory 设置 `max-parallel`；
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

manifest Repo ID 是 canonical 相对路径，允许 `adapter/ai-sdk`，拒绝绝对路径、dot traversal、反斜杠与控制符。
artifact 只接受 canonical `dir/**` 或顶层文件 glob。collector 在每次读写时做 containment 检查。
collector 拒绝源目录中的 symlink、后代 symlink 和特殊文件，也拒绝目标根中的 symlink。
candidate、receipt 与两类 summary 同样逐段核验 durable root 以下的目录链。任一内部 symlink 属于 runner infra。

## Release 信任链

Release job 先按最终版本生成 tarball 与 digest，所有 release Repo 安装该 artifact；通过后发布同一文件。
任何重新 pack、identity 不一致、blocking Repo 没有 pass / fail 状态或 artifact 丢失都阻止发布。

聚合 release receipt 前调用 root `verify-release`：它是这份本地结构化信任链的唯一判断入口，要求非空 grid、精确 receipt 集、全 pass 与同一 tarball digest/tag，
而不是在 workflow 里另写 package/receipt 判定。

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
