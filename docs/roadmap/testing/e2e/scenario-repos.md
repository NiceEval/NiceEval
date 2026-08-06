# 真实场景 Repo

场景 Repo 是测试的真实用户项目和隔离单位。它承载 NiceEval 依赖、Eval、Experiment、Report、adapter 与服务，
但不承载第二套 Behavior / World 语义。

## 目录形状

```text
e2e/
├── cli/
├── report/
├── package-commonjs/
├── adapter/
│   ├── ai-sdk/
│   ├── codex-sdk/
│   └── codex-cli/
├── journey-first-eval-to-debug/
├── lifecycle-interrupt-cleanup/
└── scripts/                         # 发现、pack、注入、executor、artifact
```

叶子项目至少包含：

```text
package.json
pnpm-lock.yaml
e2e.json
niceeval.config.ts
evals/
experiments/
test/
```

按需要增加 `agents/`、`reports/`、`src/`、`compose.yaml`、`Dockerfile` 和静态 fixture。
目录不必为了形式把所有项目拆得很小；一组 Result 能只读消费同一次昂贵证据时，可以留在一个 Repo。
会修改当前结果或生命周期状态的 Journey 必须独立。

## Repo Manifest

`e2e.json` 只描述编排条件：

```ts
type Executor =
  | { kind: "host" }
  | { kind: "docker"; image: string };

interface E2ERepoManifest {
  schemaVersion: 1;
  id: string;
  areas: readonly (
    | "cli"
    | "report"
    | "package"
    | "runner"
    | "adapter"
    | "sandbox"
  )[];
  lanes: readonly ("pr" | "main" | "nightly" | "release")[];
  executor: Executor;
  command: readonly [string, ...string[]];
  timeoutMinutes: number;
  secrets: readonly string[];
  requires?: {
    docker?: boolean;
    externalNetwork?: boolean;
    platforms?: readonly ("linux" | "darwin")[];
    runtimes?: readonly string[];
  };
  paths: readonly string[];
  artifacts: readonly string[];
}
```

manifest 不含测试标题、expected、page matrix、历史 bug 或 contract anchor。`paths` 只是选择优化；无法计算 diff 时多跑，
不能静默少跑。

## 候选包信任链

根 runner 对每次本地整组或 CI workflow：

1. 从待测 checkout pack 一份候选 tarball；
2. 计算 tarball 字节 digest；
3. 把每个选中 Repo 复制到新的临时目录；
4. 只在副本中把 `niceeval` dependency 改为 tarball；
5. 安装后核对 lockfile、解析路径和实际版本来自该 tarball；
6. 把 digest、Repo ID 和复现命令写入摘要。

场景 Repo 禁止 workspace link、相邻源码相对 import、直接执行根仓库 `src/` 或修改 `node_modules/niceeval`。
否则测试通过只说明工作树能自洽，不能说明发布包可消费。

Release 必须发布通过 preflight 的同一 tarball；验收后重新 pack 会切断信任链。

## Executor 与被测 Backend 分开

Executor 回答测试进程在哪里运行：

- `host`：本机 / Actions runner 的隔离副本；
- `docker`：固定 digest 镜像内的隔离副本，不把源码树可写挂载进容器。

被测 backend 回答 NiceEval 连接什么：本地 HTTP 进程、Docker Compose 服务、真实 SDK、真实 CLI、远端 provider 或 sandbox。
它是 Repo 自己的 fixture，不进入通用 executor 类型。

因此 Docker executor 不自动证明真实 provider；host executor 连接 Docker sandbox 也不等于没有 Docker 边界。
第一版只实现 host 和 Docker 两种 executor。

## 数据与观察边界

- CLI 结果从 exit、stdout、stderr、PTY、JUnit 或 `show --json` 读取；
- Report 从 `show`、`view --out`、HTTP 和浏览器读取；
- Record 格式测试可以用公开 `niceeval/record` API；
- Adapter 从公开运行流和 `show --execution/--timing/--json` 读取；
- 除非磁盘格式本身就是被测契约，不直接扫描 `.niceeval/` 私有布局；
- 不 import 候选内部类型给测试手写 expected。

测试可以从公开 history 取得动态 locator，因为 locator 是上一步用户获得的结果；它随后必须被另一条公开命令真正消费。

## 隔离规则

- 根 runner 每个 Repo、每次重试都创建新副本；
- Vitest 文件默认不依赖顺序；同一 Repo 的共享 evidence 在 prepare 完成后只读；
- 需要写的测试使用独立结果根 / 项目副本，或独占的 Journey Repo；
- Docker container、network、volume 名带 run ID，不使用全局固定名；
- 本地 `--keep-workdir` 是显式诊断选项，CI 永远收 artifact 后清理；
- secret 只进子进程环境，摘要和 artifact 统一脱敏，不写进 fixture、manifest 或命令行。

## Adapter Repo

每个 adapter Repo 应包含最小而真实的 Eval / Experiment 集：

- 一个正常消息往返；
- 一个该 adapter 独有能力，例如工具、session、MCP、usage 或 sandbox；
- 一个可控失败或断流；
- 公开 readback 能确认上游身份被正确保留 / 规范化。

“把所有 Eval 跑完且 exit 0”不够。测试必须列出期望 Eval ID，并对每个必要结果或关键事件作断言，防止 discovery 少排后假绿。

本地协议 backend 固定版本和响应，可进入 PR；真实 provider 版本、模型和 CLI 身份写入 artifact，进入可信 lane。

## Repo 准入

新 Repo 合入前必须证明：

1. 可从仓库外副本安装候选 tarball；
2. 本地单条命令和单文件测试可复现；
3. expected 不来自候选；
4. 失败报告含阶段和原始收据；
5. 无密钥 Repo 能在 PR lane 运行，live Repo 缺 secret 时启动前明确失败；
6. 历史 bug case 能杀死旧实现；
7. 被替代旧测试在同批删除。
