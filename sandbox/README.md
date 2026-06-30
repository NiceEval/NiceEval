# 预制 agent 沙箱模板

把 **codex / claude-code / bub** 三个 coding-agent CLI 预先烘焙进沙箱镜像/模板,
让后续 eval **跳过 setup 阶段的安装**(npm 全局装 + uv 装 bub,通常几十秒~几分钟)直接开跑。

按平台分文件夹,每个平台的产物类型不同:

```text
sandbox/
  docker/   # docker image —— Dockerfile + bub-override.txt(e2b 也读这份 Dockerfile)
  e2b/      # e2b template —— e2b.toml(参数备查;实际构建读 ../docker/Dockerfile)
  vercel/   # vercel snapshot —— build-vercel-snapshot.mts(microVM 跑等价安装后拍快照)
```

docker 与 e2b **共用 [`docker/Dockerfile`](./docker/Dockerfile)**(vercel 用等价的运行时安装脚本)。
关键约定:三个 CLI 都装到 `/usr/local/bin` —— 对所有沙箱用户(docker `node` / e2b `user` /
vercel `vercel-sandbox`)都在 `PATH` 上。agent adapter 的 `setup()` 会 `command -v` 探测,
命中就跳过安装(见 [`src/agents/codex.ts`](../src/agents/codex.ts)、`claude-code.ts`、`bub.ts`)。

> 没有预制模板也能正常跑 —— adapter 探测不到就回退到原来的安装流程。预制只是更快。

---

## Docker

```bash
cd sandbox/docker
docker build -t fasteval-agents:node24 .
```

用(eval / experiment 里):

```ts
import { dockerSandbox } from "fasteval";
export default defineExperiment({
  sandbox: dockerSandbox({ image: "fasteval-agents:node24" }),
  // …
});
```

发布(让别人直接拉):`docker tag` + `docker push` 到你的 registry,文档里给出镜像名即可。

## E2B

需先 `e2b auth login`。`e2b template create` 从 `sandbox/docker` 目录读 `Dockerfile`(+ 同目录
`bub-override.txt`)构建模板 `fasteval-agents`(内存必须显式给大 —— e2b 默认 base 只有 ~481MB,
跑 `npm install` Next.js 依赖会 OOM):

```bash
cd sandbox/docker
e2b template create fasteval-agents \
  --memory-mb 4096 --cpu-count 2 \
  -c "tail -f /dev/null" \
  --ready-cmd "command -v codex && command -v claude && command -v bub"
```

> 内存/CPU 在**构建时**定,创建沙箱时不能改 —— 这正是必须用预制模板(而非默认 base)的原因。
> 旧版 CLI 的 `e2b template build` 已废弃;[`e2b/e2b.toml`](./e2b/e2b.toml) 记录等价参数备查。

用:

```ts
import { e2bSandbox } from "fasteval";
export default defineExperiment({
  sandbox: e2bSandbox({ template: "fasteval-agents" }),
  // …
});
```

模板构建在你的 e2b team 下;团队成员直接按模板名引用。

## Vercel

Vercel 没有「从 Dockerfile 构建模板」,只能对运行中的 microVM 拍快照。
[`vercel/build-vercel-snapshot.mts`](./vercel/build-vercel-snapshot.mts) 在 microVM 里跑等价安装后 snapshot:

```bash
# 需要 VERCEL_API_TOKEN + VERCEL_TEAM_ID [+ VERCEL_PROJECT_ID]
node --import tsx sandbox/vercel/build-vercel-snapshot.mts
# → 打印 snapshotId: snap_xxx
```

用:

```ts
import { vercelSandbox } from "fasteval";
export default defineExperiment({
  sandbox: vercelSandbox({ snapshotId: "snap_xxx" }),
  // …
});
```

---

## 改了 bub 的安装规格怎么办

bub 的 `BUB_OVERRIDE` / `OTEL_PLUGIN` 在几处出现,改一处要同步其余:

1. [`src/agents/bub.ts`](../src/agents/bub.ts)(运行时回退安装 + 探测)
2. [`docker/bub-override.txt`](./docker/bub-override.txt)(docker / e2b 烘焙时 `COPY` 进去的 override 行)
   + [`docker/Dockerfile`](./docker/Dockerfile) 里 `--with` 的 OTEL 插件 URL
3. [`vercel/build-vercel-snapshot.mts`](./vercel/build-vercel-snapshot.mts)(vercel 烘焙)

> override 文件用 `COPY` 而非 shell 写入 —— e2b 的 Dockerfile 解析会吃掉反斜杠 / 双引号。
> `--overrides` 不能省:OTEL 插件依赖上游 `bubbuild/bub`,与 fork 冲突,靠 override 统一解析。

改完重新构建对应后端的模板。
