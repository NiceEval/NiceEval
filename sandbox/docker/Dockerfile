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

FROM node:24-slim AS base

# 各 target 共用的系统依赖:git/curl(git+https 安装、uv 安装脚本)、ca-certificates。
# build-essential / python3 只留给需要它们的 target，避免 npm 型 image 背上多余工具链。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM base AS codex

# npm 全局安装 → /usr/local/bin/codex。
ARG CODEX_VERSION=0.144.1
RUN npm install -g @openai/codex@${CODEX_VERSION}
RUN codex --version

FROM base AS claude-code

# npm 全局安装 → /usr/local/bin/claude。
ARG CLAUDE_CODE_VERSION=2.1.207
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
RUN claude --version

FROM base AS opencode

# npm 全局安装 → /usr/local/bin/opencode（包名 opencode-ai）。
ARG OPENCODE_VERSION=1.18.5
RUN npm install -g opencode-ai@${OPENCODE_VERSION}
RUN opencode --version

FROM base AS openclaw

# npm 全局安装 → /usr/local/bin/openclaw。OpenClaw CLI 要求 Node >=22.22.3 或 >=24。
ARG OPENCLAW_VERSION=2026.7.1-2
RUN npm install -g openclaw@${OPENCLAW_VERSION}
RUN openclaw --version

FROM base AS hermes

# Hermes 装到 $HOME/.local（与 Adapter 运行时回退同一路径）；系统 python3 供
# sessions export 失败时的 sqlite 旁读。以运行时的 node 用户安装。
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*
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
