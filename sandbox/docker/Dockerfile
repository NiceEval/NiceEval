# NiceEval 预制 coding-agent 镜像。每个 target 只装一个 CLI，发布为同名 Docker Hub
# repository（niceeval/codex、niceeval/claude-code、niceeval/bub、niceeval/opencode、
# niceeval/hermes、niceeval/openclaw），使 eval 不必下载无关的 Agent 和运行时依赖。
#
# 这是 Docker provider 的基线配方。E2B 从 provider 官方 Agent template 派生，Vercel
# 对运行中的 microVM 拍 snapshot；三者的构建入口见 ../README.md。
#
# Codex / Claude Code / OpenCode / OpenClaw 装到 /usr/local/bin；Bub / Hermes 按
# Docker provider 的标准 node 用户装到 $HOME/.local。Bub 另写 NiceEval 安装规格指纹，
# Adapter 只有在指纹完全匹配时才跳过安装。
#
# 非 root 是预制环境的义务，不是 runner 的强加（docs/feature/sandbox/library.md「执行身份」）：
# NiceEval 不再静默把执行身份换成非 root，镜像自己必须声明 USER。安装步骤都以 root 执行（base
# 未声明 USER，继承 Docker 默认 root）；每个 target 收尾前切到 slim 基础镜像自带的 node 用户
# （UID 1000），version smoke test 在切换后跑，顺带验证该用户能直接调用装好的 CLI。
#
# 跨 provider 基线工具面契约（与 E2B 侧 src/sandbox/e2b-agent-template.ts 的
# withNodeToolContract / verifyE2BNodeToolContract 同一份契约，见
# docs/feature/sandbox/library/prebuilt-environments.md「跨 provider 基线工具面」）：
# 包管理器只保证 npm 与 corepack，不预装 yarn 实体；系统 python3 保证存在。两条都在 base 里
# 一次性落地，六个 target 全部继承，是发布前的构建自检项之一（见 ../../.github/workflows/docker-image.yml）。

FROM node:24-slim AS base

# 各 target 共用的系统依赖:git/curl(git+https 安装、uv 安装脚本)、ca-certificates、python3
# （跨 provider 基线工具面统一，见上）。build-essential 仍只留给需要编译原生依赖的 target
# （目前只有 bub），避免其余 npm 型 image 背上用不到的工具链。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*

# node:24-slim 自带 yarn 1.22(/usr/local/bin/{yarn,yarnpkg} 符号链接指向 /opt/yarn-v*)；
# 官方基线的包管理器只保证 npm 与 corepack,要 yarn 的派生项目自己 corepack enable 或安装。
# glob 匹配 /opt/yarn-v* 以容忍基础镜像升级后的版本号变化。
RUN rm -rf /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

FROM base AS codex

# npm 全局安装(root)→ /usr/local/bin/codex,该路径对所有用户可执行。收尾切到 node
# 用户;version smoke test 在切换后跑,顺带验证非 root 身份能直接调用装好的 CLI。
ARG CODEX_VERSION=0.144.1
RUN npm install -g @openai/codex@${CODEX_VERSION}
USER node
RUN codex --version

FROM base AS claude-code

# npm 全局安装(root)→ /usr/local/bin/claude。Claude Code 在 root 下拒绝
# --dangerously-skip-permissions,收尾必须声明非 root USER,不能只装完就结束。
ARG CLAUDE_CODE_VERSION=2.1.207
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
USER node
RUN claude --version

FROM base AS opencode

# npm 全局安装(root)→ /usr/local/bin/opencode（包名 opencode-ai）。收尾切到 node 用户。
ARG OPENCODE_VERSION=1.18.5
RUN npm install -g opencode-ai@${OPENCODE_VERSION}
USER node
RUN opencode --version

FROM base AS openclaw

# npm 全局安装(root)→ /usr/local/bin/openclaw。OpenClaw CLI 要求 Node >=22.22.3 或
# >=24。收尾切到 node 用户。
ARG OPENCLAW_VERSION=2026.7.1-2
RUN npm install -g openclaw@${OPENCLAW_VERSION}
USER node
RUN openclaw --version

FROM base AS hermes

# Hermes 装到 $HOME/.local（与 Adapter 运行时回退同一路径）；系统 python3 现由跨 target 基线
# 统一提供（sessions export 失败时的 sqlite 旁读用得到）。以运行时的 node 用户安装。
USER node
ARG HERMES_VERSION=0.19.0
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && $HOME/.local/bin/uv tool install hermes-agent==${HERMES_VERSION}
# Hermes 没有稳定的 --version 契约；--help 完成入口 import 与 CLI 初始化。
RUN $HOME/.local/bin/hermes --help >/dev/null

FROM base AS bub

# Bub 有原生依赖，单独加编译工具链。以运行时的 node 用户安装，布局与 adapter 的运行时回退完全相同。
# bub-override.txt 把 bub 钉到一个 PyPI 版本:OTEL 插件所在 workspace 把 bub 声明成 git 依赖,
# 不覆盖的话构建会拉 Bub 主干,镜像里的版本随构建时间漂移。
# override 行、--with 的 OTEL 插件与 marker hash 都必须与 agents/bub-install-spec.ts 的默认 pin
# 一致(Dockerfile 不能 import TypeScript,漂移由 src/sandbox/official-baselines.test.ts 守护)。
# COPY 到 /opt(持久),不要用 /tmp —— e2b 的层间不保证保留 /tmp。
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY bub-override.txt /opt/bub-override.txt
RUN chown node:node /opt/bub-override.txt
USER node
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && $HOME/.local/bin/uv tool install --python 3.12 --prerelease allow 'bub' \
      --overrides /opt/bub-override.txt \
      --with 'git+https://github.com/bubbuild/bub-contrib.git@34715077877041b21472dcca39d91529296a1a9e#subdirectory=packages/bub-tapestore-otel' \
 && mkdir -p $HOME/.local/share/niceeval \
 && printf '%s' '7319e17be62e' > $HOME/.local/share/niceeval/bub-install-hash

# Bub 没有 --version；--help 会完成同一条入口的 Python import 与 CLI 初始化。
RUN $HOME/.local/bin/bub --help >/dev/null
