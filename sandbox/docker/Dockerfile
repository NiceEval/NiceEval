# fasteval 预制 agent 镜像 —— 把 codex / claude-code / bub 三个 CLI 烘焙进来,
# 让后续 eval 跳过 setup 阶段的安装(几十秒~几分钟)直接开跑。
#
# 一份 Dockerfile,三种后端共用(见 ../README.md):
#   · docker  : docker build -t fasteval-agents:node24 .
#   · e2b     : e2b template create fasteval-agents -d Dockerfile …(见 README)
#   · vercel  : build-vercel-snapshot.mts 在 microVM 里跑等价安装后 snapshot
#
# 关键约定:三个 CLI 都装到 /usr/local/bin(对所有沙箱用户都在 PATH 上)——
# docker 跑命令用 node 用户、e2b 用 user、vercel 用 vercel-sandbox,均能 `command -v` 命中,
# 于是 agent adapter 的 setup() 探测到就跳过安装(见 agents/{codex,claude-code,bub}.ts)。

FROM node:24-slim

# 系统依赖:git/curl(git+https 安装、uv 安装脚本)、ca-certificates、build-essential(bub 的原生依赖编译)。
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

# ── codex + claude-code:npm 全局装 → /usr/local/bin/{codex,claude} ──
RUN npm install -g @openai/codex @anthropic-ai/claude-code

# ── bub:uv 装 python3.12 工具,二进制落到 /usr/local/bin(对所有用户可见)──
# UV_INSTALL_DIR  : uv 自身装到 /usr/local/bin。
# UV_TOOL_BIN_DIR : `uv tool install` 暴露的入口(bub)落到 /usr/local/bin。
# UV_TOOL_DIR     : 工具的虚拟环境放到 /opt(与用户 home 无关,任何沙箱用户都能用)。
# UV_PYTHON_INSTALL_DIR 放到 /opt:uv 默认把下载的 cpython 装到 /root/.local(700,非 root 用户进不去),
# bub 的 venv python 是指向它的符号链接 → 非 root 跑 bub 报 `Permission denied`。放 /opt 才对所有用户可达。
ENV UV_INSTALL_DIR=/usr/local/bin \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python
# bub-override.txt:把 bub 钉到 CorrectRoadH fork —— 用 COPY 带进来,别用 shell 写文件
# (e2b 的 Dockerfile 解析会吃掉反斜杠 / 双引号,导致 override 文件畸形)。
# --overrides 是必须的:OTEL 插件依赖上游 bubbuild/bub,与 fork 冲突,靠 override 统一。
# override 行与 --with 的 OTEL 插件都必须与 agents/bub.ts 的 BUB_OVERRIDE / OTEL_PLUGIN 一致。
# COPY 到 /opt(持久),不要用 /tmp —— e2b 的层间不保证保留 /tmp。
COPY bub-override.txt /opt/bub-override.txt
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
 && uv tool install --python 3.12 --prerelease allow 'bub' \
      --overrides /opt/bub-override.txt \
      --with 'git+https://github.com/CorrectRoadH/bub-contrib.git@fix/tapestore-otel-tape-entry-validation#subdirectory=packages/bub-tapestore-otel' \
 && chmod -R a+rX /opt/uv-tools /opt/uv-python
# ↑ venv + 其指向的 cpython 都建在 root 名下且默认不让其它用户执行;沙箱以非 root user 跑 bub 时
#   会报 `bad interpreter: .../python: Permission denied`。a+rX 让目录可遍历、可执行文件对所有人开放。
# ↑ uv 把 venv 建在 root 名下且默认不让其它用户执行;沙箱以非 root user 跑 bub 时
#   会报 `bad interpreter: .../python: Permission denied`。a+rX 让目录可遍历、可执行文件对所有人开放。

# 自检:三个 CLI 都应在 PATH 上(构建时即失败,而非到 eval 才发现)。
RUN command -v codex && command -v claude && command -v bub
