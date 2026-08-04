# 官方基线不预装 yarn、补齐 python3——跨 provider 基线工具面统一

**裁决(2026-08-04)**:六个 Docker target 与三个 E2B template 共用同一份基线工具面契约:官方基线的包管理器只保证 npm 与 corepack,不预装 yarn 实体;官方基线保证 python3 存在。

- Docker 侧:node:24-slim 自带 yarn 1.22(`/usr/local/bin/{yarn,yarnpkg}` 符号链接 → `/opt/yarn-v1.22.22`,真机验证过实际布局),base target 统一 `rm -rf /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg`;python3 并入 base 的共用 apt 安装,六个 target 全部继承。
- E2B 侧:`withNodeToolContract` 加两步——存在 yarn 就移除、断言 python3 存在(E2B 官方起点已带,只 fail fast 不安装,不是安装步骤);`verifyE2BNodeToolContract` 的最终自检数组同步扩两条。
- 版本位:Docker 的 `AGENT_BASELINE_RECIPE_REVISION` 六个 agent 全部 +1(一个版本号 = 一套基线配方,配方变就 bump)。E2B 侧 claude-code / codex 的已发布 template(仍是历史 tag `v0.6.1`)随之落后于源码新 tag,`sandbox/e2b/published.json` 补 `supersededBy` 承认分叉;bub 原有的 `supersededBy` 同步从 `0.4.0-r1` 前移到 `0.4.0-r2`。
- CI 门槛:Docker workflow(`.github/workflows/docker-image.yml`)在推送前新增单平台 self-check 构建 + `docker run` 断言(`command -v yarn` 必须为空、`python3 --version` 必须成功);E2B 侧复用 `verifyE2BNodeToolContract`,两侧断言内容一致。

**起因**:两处实证分别撞翻现状。yarn 侧——node:24-slim 自带 yarn 与 E2B 官方 template 无 yarn 的差异实证撞翻过下游 `npm install`(EEXIST 冲突)。python3 侧——[docker-default-image-no-python3](docker-default-image-no-python3.md)记的是通用默认镜像的同类缺口,toggl-cli 实证 5/6 条因缺 python3 失败,证明依赖 python3 的 eval 在 npm 型官方基线(claude-code / codex / opencode / openclaw)上必挂。

**翻案**:Dockerfile base 原注释"build-essential / python3 只留给需要它们的 target,避免 npm 型 image 背上多余工具链"——python3 半句作废,python3 现在是全部六个 target 的基线保证,不再按 target 分支;build-essential 半句仍然有效,继续只留给需要编译原生依赖的 bub。

**未发布项**:E2B 侧的三个 template(claude-code / codex / bub)源码配方已推进到新 tag,实际重建与发布(需要 `e2b auth login` 与维护者凭据)未执行,`sandbox/e2b/published.json` 的 `supersededBy` 字段记录了这个待发布状态,不是伪造已发布事实。

**落点**:`sandbox/docker/Dockerfile`(base target)、`src/sandbox/e2b-agent-template.ts`(`withNodeToolContract`、`verifyE2BNodeToolContract`)、`src/sandbox/e2b-agent-template.test.ts`、`src/agents/coding-cli-versions.ts`(`AGENT_BASELINE_RECIPE_REVISION`)、`.github/workflows/docker-image.yml`、`sandbox/e2b/published.json`、`docs/feature/sandbox/library/prebuilt-environments.md`「跨 provider 基线工具面」、`docs/engineering/testing/unit/sandbox.md`「官方 E2B coding-agent 模板契约」。
