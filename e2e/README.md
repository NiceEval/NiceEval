# e2e：真实模型全链路 CI 套件

设计见 [`docs/engineering/e2e-ci/README.md`](../docs/engineering/e2e-ci/README.md)。全程真实模型,没有任何 mock——费用靠便宜模型档位、小 `runs`、per-experiment `budget` 控制。

- `shared/`：唯一一份 eval / experiment 定义,全部是参数化 factory。断言逻辑改这里、全矩阵生效。
- `apps/`：被测应用,从 `examples/zh/tier1/<name>` 拷来并裁成只保 backend 的协议夹具(前端 / vite / 开发工作流都不参与被测协议,已删;`src/backend/` 与 tier1 保持一致)。凭据在各自 `.env`(不进 git,变量集见各自 `.env.example`);judge 凭据在 `projects/<name>/.env`(`NICEEVAL_JUDGE_KEY` / `NICEEVAL_JUDGE_BASE`)。
- `projects/`：每个 SDK 一个薄 niceeval 项目——adapter(拷自 tier1)+ `profile.ts`(协议现实声明)+ 3 行 stub。SDK 间差异只允许出现在 profile 里。
- `scripts/verify.mjs`：e2e 的"真正的测试"。把 CLI 当黑盒子进程跑,对照期望表校验退出码 + `summary.json`(含"期望 exit 1"的 verdicts 实验)。

## 跑起来

```sh
# 一次性:装依赖
pnpm install --dir e2e
for d in e2e/apps/{ai-sdk-v7,claude-sdk,codex-sdk,pi-sdk}; do pnpm install --dir $d; done
python3 -m venv e2e/apps/langgraph/.venv && e2e/apps/langgraph/.venv/bin/pip install -r e2e/apps/langgraph/requirements.txt

# 起被测应用(每个一个终端,或 CI 里 nohup;eval 不代管进程)
(cd e2e/apps/ai-sdk-v7 && pnpm start)     # :34001
(cd e2e/apps/claude-sdk && pnpm start)    # :32001
(cd e2e/apps/codex-sdk && pnpm start)     # :31001
(cd e2e/apps/pi-sdk && pnpm start)        # :33001
(cd e2e/apps/langgraph && .venv/bin/python src/backend/server.py)  # :35000

# 全矩阵对账(或单项目:node e2e/scripts/verify.mjs ai-sdk-v7)
node e2e/scripts/verify.mjs
```

## L1 沙箱矩阵(claude-code / codex × docker)

`projects/claude-code`、`projects/codex` 是 docs/engineering/e2e-ci/README.md §4.2 的沙箱矩阵:内置的
`claudeCodeAgent()` / `codexAgent()` 接 `dockerSandbox()`,不连任何 `e2e/apps` 里的被测应用,
前置条件只有本机 **docker daemon 在跑**(`docker info` 能成功):

```sh
docker info   # 确认 daemon 可用

# 单项目(每个都是 ci / features / verdicts 三个实验)
node e2e/scripts/verify.mjs claude-code
node e2e/scripts/verify.mjs codex

# 按组跑(CI 就是这么切的):sdk = 五个 HTTP 项目,sandbox = 沙箱矩阵
node e2e/scripts/verify.mjs sdk
node e2e/scripts/verify.mjs sandbox
```

- `experiments/ci.ts`:基线 agent(不装 skills/MCP),覆盖 basic-qa / session-isolation /
  create-file / modify-file / run-command / sandbox-smoke / skill-absent / mcp-absent
  这几条反例与冒烟用例。
- `experiments/features.ts`:同一个 adapter 额外挂 `skills: [{ kind: "repo", source: "Effect-TS/skills" }]`
  + `mcpServers`(`@modelcontextprotocol/server-everything`),只跑 `feature-` 前缀的正例
  (`feature-skill-used` / `feature-mcp-tool`)。
- `experiments/verdicts.ts`:复用 `shared/verdicts.ts` 的 deliberate-fail/error。

每个 attempt 都是全新容器(要重装 CLI),比 `e2e/apps` 那五个 HTTP 项目慢得多——本机
Apple Silicon 下 Docker 拉的是 amd64 镜像、走模拟,单个 attempt 数十秒到几分钟很常见;
Linux amd64 的 CI runner 上原生跑应该明显更快。`.env` 变量集(不进 git,见各自
`.env.example`):

| 项目 | 变量 | 说明 |
|---|---|---|
| `projects/claude-code` | `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` | 沙箱里的 `claude` CLI 用;走 DeepSeek 的 Anthropic 兼容端点 |
| `projects/codex` | `CODEX_API_KEY` / `CODEX_BASE_URL` | 沙箱里的 `codex` CLI 用;走 s2a 代理 |
| 两者都要 | `NICEEVAL_JUDGE_KEY` / `NICEEVAL_JUDGE_BASE` | `t.judge.autoevals.*` 用,和其它项目共享同一套 judge 凭据 |

`skills:` 装的是 [`Effect-TS/skills`](https://github.com/Effect-TS/skills)(只有一个
`effect-ts` skill,触发条件明确,所以不必写 `skills: [...]` 选择集)。安装由 adapter 自己
用 git 完成(clone → 按 ref 钉版本 → 拷进该 agent 的 skill 目录:claude-code 是
`.claude/skills`,codex 是 `.agents/skills`),装完写一份安装 manifest 到沙箱的
`__niceeval__/agent-setup.json`——`feature-skill-used` 的「安装痕迹」断言读的就是它。
