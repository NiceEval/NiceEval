# 官方基线制品的版本跟被装的 Agent 走，不跟 niceeval 的 release

**裁决(2026-07-25)**：公共 E2B template 与公共 Docker 镜像的 tag 统一为
`<Agent 版本>-r<配方修订>`（`0.144.1-r2`、`2.1.207-r2`、bub `0.3.9-r2`）。版本位是制品里那个
Agent 的版本，取自与 Adapter 运行时回退安装同一批版本常量（`src/agents/coding-cli-versions.ts`
的 `AGENT_BASELINE_VERSION`）；`-r` 位是 NiceEval 配方自己的修订号（Node 工具契约、PATH
规范化、换 pin 的 commit、插件集合变了就 +1，Agent 版本一变归 1）。三个 Agent 各自独立发版；
同一个 Agent 的 E2B 与 Docker 制品共用一个版本号。

**曾选方案**：三份模板共用一个 tag，值取 `git describe --tags`（即 niceeval 自己的 release，
`v0.6.1`）；Docker 镜像由 push `v*` tag 的 workflow 发布同名 tag。

**否决理由**：

- 版本号答非所问。消费者问的是"这份环境里的 Agent 是哪一版"，tag 回答的却是"构建那天库发到第几版"。
- 两个方向都错配：库发一个 patch 要连带重建三份内容没变的制品；换 Codex CLI 版本反而不改 tag，
  只能原地覆盖——正是本仓库自己写的「不要覆盖同一个 tag」禁令（覆盖会让"同一配置"在不同时间指向
  不同环境，跑分失去可比性）。
- 三份绑同一个 tag 还制造了假耦合：只改 Codex 也得连带发 Claude Code 与 Bub。

**落点**：`src/agents/coding-cli-versions.ts`（版本 + 修订 + `agentBaselineVersionTag()`）、
`src/sandbox/docker-agent-image.ts`（`NICEEVAL_*_DOCKER_IMAGE`）、
`src/sandbox/e2b-agent-template.ts`（`PUBLISHED_E2B_BASELINE_TAG` + `e2bBaselineBuildTag()`）、
`sandbox/e2b/build-agent-template.mts`、`.github/workflows/docker-image.yml`（改由基线配方变更触发）。
契约正文在 `docs/feature/sandbox/library/prebuilt-environments.md#版本号跟着被装的-agent-走`。

**两侧发布语义不对称，是刻意的**：Docker 发布由 CI 在配方落 `main` 时自动完成，所以镜像常量直接由
版本常量派生；E2B 发布是维护者手动动作（要 `e2b auth login`），所以 E2B 常量指向的是
`sandbox/e2b/published.json` 台账记录的**已发布事实**，不是源码派生值。
`src/sandbox/official-baselines.test.ts` 守护这条边界：台账记录的 Agent 版本与源码版本常量分叉时
测试红——bump 版本常量而不发布新模板，会让导出的常量指向一份装着旧 Agent 的制品，而类型检查一次都拦不住。
这正是 [e2b-agent-template-npm-global-prefix](e2b-agent-template-npm-global-prefix.md) 的翻车形态。

**bub 的版本位**：bub 装的是 fork 的不可变 commit（`86fbd0fe`，2026-07-08），上游 tag 到
`0.3.9`（2026-06-13）为止，`0.4.0` 发布于 2026-07-17、晚于该 commit，所以版本位记 `0.3.9`，
fork commit 与 OTel 插件 commit 的差异由 `-r` 位承担。换 pin 时同批核对 `DEFAULT_BUB_VERSION`。
