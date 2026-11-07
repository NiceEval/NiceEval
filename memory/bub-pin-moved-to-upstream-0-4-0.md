# Bub pin 从个人 fork 迁到上游 0.4.0（丢掉一个未上游的修复）

**裁决(2026-07-25)**：Bub 从 PyPI 装上游 release，默认 `bub==0.4.0`，退役
`git+https://github.com/CorrectRoadH/bub.git@86fbd0fe` 这个 fork pin。同批把 OTel 插件 pin 推到
`bub-contrib@34715077`（#53「align with Bub contract boundaries」之后，与 0.4.0 同代）。

**代价（明确接受）**：fork 相对 0.4.0 是 diverged（ahead 1 / behind 8），那一个 commit
`fix(tape): record assistant text accompanying tool calls` **没有进上游** —— 上游 0.4.0 的
`model_runner.py` 在工具调用分支仍是 `response_text=None`。所以模型在同一步里既说话又调工具时，
那段助手文本不进 tape，也就投不出 span，niceeval 的 transcript 与 judge 材料在工具调用回合少掉这段话。
用户在被告知后选择接受，等上游自己修。上游修了就把 `DEFAULT_BUB_VERSION` 往前推。

**override 文件不能删（反直觉，容易误判成遗留物）**：`bub-tapestore-otel` 所在 workspace 的根
`pyproject.toml` 写了 `[tool.uv.sources] bub = { git = "..." }`，所以 `--with <插件 git URL>` 会
把 `bub` 一起从 **git 主干**拉下来。实测 `uv tool install 'bub==0.4.0' --with <插件>` 直接
`No solution found ... there is no version of bub==0.4.0`（PyPI 版本被 git source 顶掉）。可行形态是
保留 overrides 文件、内容写 `bub==0.4.0`，requirement 传裸 `bub`：实测装到 PyPI 0.4.0，`bub.tape`
与 `bub_tapestore_otel.store` 都导得进。不写 override 的后果不是报错，是每次安装静默拉主干、版本随时间漂移。

**插件与 Bub 必须同代**：Bub 0.3.10 起 vendor 了 `bub.tape`，#50 之后的插件从那里取类型；配 0.3.9
直接 import 失败（0.3.9 的 `src/bub/` 里没有 `tape.py`）。反过来 #50 之前的插件按 `republic.TapeEntry`
校验，配新 Bub 是 span 全被拒、时间轨静默为空（那次事故见
[bub-tapestore-otel-tapeentry-drift](bub-tapestore-otel-tapeentry-drift.md)）。因此
`bubAgent({ version, otelPlugin })` 两个旋钮成对使用，e2e 的 `legacy` 版本线钉的就是
`0.3.9 + bub-contrib@7967e5e7`（两个组合都在本机隔离 `UV_TOOL_DIR` 下真实装过）。

**落点**：`src/agents/bub-install-spec.ts`（`DEFAULT_BUB_REQUIREMENT` / `bubRequirement()`，
替掉 `DEFAULT_BUB_OVERRIDE`）、`src/agents/bub.ts`（`version` / `otelPlugin` 配置项 + `BubInstallPin`）、
`src/agents/coding-cli-versions.ts`（`DEFAULT_BUB_VERSION = "0.4.0"`，基线修订归 1）、
`sandbox/docker/Dockerfile` 与 `bub-override.txt`、`sandbox/vercel/build-vercel-snapshot.mts`、
`e2e/adapter/bub/experiments/legacy.ts`。安装指纹随之从 `83770925b77a` 变成 `7319e17be62e`——
已发布的公共模板/镜像 marker 因此对不上，Adapter 会回退完整安装，直到按
[official-baseline-versioning-follows-agent](official-baseline-versioning-follows-agent.md) 重新发布制品。
