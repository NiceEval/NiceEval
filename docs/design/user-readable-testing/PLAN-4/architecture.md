# 方案 4：Architecture

**相关文档**：[README](README.md) · [Lifecycle](lifecycle.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## 依赖方向

```text
Feature / 历史 bug
        ↓
真实场景 Repo 中的 fixture + 原生 Vitest 断言
        ↓
公开 Library / 候选包 / CLI / HTTP / Browser / Adapter
        ↓
ProcessResult、结构化文档、网络与协议 evidence
```

编排层只包住场景 Repo：

```text
e2e.json → 选择项目 → 构建候选 tarball → 隔离安装 → executor → 收集 artifact
```

编排层不读取 `.niceeval/`，不解码产品输出，也不拥有预期。

## 目录

```text
e2e/
├── cli/                    # ┐
├── runner/                 # │ 功能场景 Repo；子功能与 Journey 是测试文件
├── report/                 # │
├── package/                # │
├── lifecycle/              # ┘
├── adapter/                # 另一组 Adapter 兼容性 Repo
│   ├── ai-sdk/
│   ├── codex-cli/
│   └── local-protocol/
└── scripts/                 # 只做发现、注入、executor、artifact
```

每个叶子项目都可以复制到仓库外执行，至少包含自己的 `package.json`、lockfile、`e2e.json`、fixture 与 `test/`。
它不能通过 workspace link 或相对路径 import NiceEval 源码。

功能 Repo 与 Adapter Repo 是两套独立消费项目。前者使用签入的确定性 fixture 验收 NiceEval 功能；后者使用真实 SDK / CLI
或对应协议故障端验收兼容性。两者只共享机械 Testkit，不共享 package graph、fixture、secret、结果根或领域 expected。

## Repo manifest

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
    runtimes?: readonly string[];
    platforms?: readonly ("linux" | "darwin")[];
    externalNetwork?: boolean;
  };
  paths: readonly string[];
  artifacts: readonly string[];
}
```

manifest 只声明运行条件。
它不含 Behavior ID、contract anchor、expected result、page matrix 或 matcher。

`paths` 是 CI 选择提示，不是守护证明。
编排器无法计算 diff 时必须多跑，不能静默少跑。

## Executor 与被测 backend 分开

Executor 回答“测试进程在哪里运行”：

- `host` 在隔离临时目录启动子进程；
- `docker` 在固定 digest 的镜像中启动同一命令，复制候选 tarball 与场景 Repo，不把源码树读写挂载进容器。

被测 backend 回答“NiceEval 连接什么”：本地进程、Docker Compose 服务、真实 SDK、真实 CLI 或远端 provider。
它属于场景 Repo fixture，不进入通用 executor 联合。

这样，使用 Docker 运行一个 Linux 场景 Repo，不会被误写成“证明了真实 provider”；在 host 上连接 Docker sandbox，也不会被误写成“测试没有 Docker 边界”。

第一版只实现 host 与 Docker executor。
新增 executor kind 必须有 host / Docker 不能表达的真实 Case；不能预先开放任意 plugin 回调。

## 候选包信任链

根入口每次运行：

1. 从当前 checkout 生成一个 tarball；
2. 对 tarball 字节计算 digest；
3. 把选中项目复制到新的临时目录；
4. 只在副本中把 `niceeval` 指向该 tarball；
5. 安装后从 lockfile 与实际定位路径核对候选身份；
6. 把 digest 写入测试摘要和 artifact。

依赖缓存只能缓存包管理器 store 与 Docker layer。
不能缓存 `node_modules`、`.niceeval`、导出站或上次测试结果并直接作为新候选输入。

release lane 必须验收随后要发布的同一份 tarball。
验证后重新 pack 再发布会切断信任链。

## 测试支持边界

允许的共享机械类型：

```ts
interface ProcessResult {
  argv: readonly string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  diagnostic(): string;
}
```

允许的机械工具：

- 创建与释放临时目录；
- 启动进程、PTY、HTTP server 或浏览器；
- 读取 JSON、NDJSON、XML；
- 保存 stdout、stderr、trace、screenshot 与 service log；
- 等待端口、URL 或显式事件就绪。

禁止的机械工具：

- 从候选结果推导 expected target / verdict / identity；
- 把完整用户动作隐藏在 scenario 名后；
- 重新实现 Report、Sample、scheduler 或 adapter 的正确性算法；
- 读取失败后退回宽松 substring；
- 在断言阶段修改共享 evidence。

领域 parser 默认留在所属场景 Repo。
至少两个项目出现相同稳定格式后，才提取纯读取工具；预期仍留在各测试文件。

## 结果与诊断

测试框架原生发现文件与标题。
每个项目输出统一的机器摘要：

```ts
interface E2ERunSummary {
  repoId: string;
  candidateDigest: string;
  executor: "host" | "docker";
  backend?: string;
  phase: "prepare" | "invoke" | "observe" | "outcome" | "cleanup";
  status: "passed" | "regression" | "infrastructure" | "skipped";
  tests: readonly {
    file: string;
    title: string;
    status: string;
    durationMs: number;
    artifacts: readonly string[];
  }[];
}
```

这是运行收据，不是产品 Behavior Registry。
JUnit 与摘要来自 Vitest reporter 或薄 adapter，不要求测试正文登记第二份元数据。

## 失败分类

- `regression`：候选包、断言、超时或 cleanup 违反本项目契约；不自动重试。
- `infrastructure`：能够结构化确认的 provider 429 / 5xx、网络故障、runner 或 Docker daemon 故障；最多在新临时目录重试一次。
- `skipped`：本次 lane 本来就不选择该项目；显式选择后缺 secret 或 runtime 属配置错误，不能悄悄 skip。

判不清就按 regression。
cleanup 失败附加在原失败后；不能遮蔽更早的 outcome。

## Oracle 独立性

- 固定 ID、page 类别、预期 verdict 与 sentinel 来自 fixture 代码或测试字面量；
- 动态 locator 可以从公开 `show --history --json` 取得，再用于公开 roundtrip；
- 不能调用候选 `enumerate()` 得到“应该有哪些 page”，再用同一个集合验证候选导出；
- adapter usage 比较同次调用的独立上游公开事件与 NiceEval 公开出口，不固定易漂 token 总数；
- local protocol backend 只能证明 NiceEval 自有错误处理和传输不变量，不能替代 live adapter 兼容性。
