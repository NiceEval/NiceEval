# 真题落地样例：Terminal-Bench 的 case、eval 与 experiment

本文把 [PLAN-4](PLAN-4.md) 落到四道真实 Terminal-Bench 题上，
回答三个可以直接复审的问题：

1. 上游题目文件放在哪里，哪些内容进环境身份，哪些内容进
   eval 判据指纹；
2. Docker 与云端 provider 分别怎样把同一个 profile 物化成
   完整 environment case；
3. `eval` 与 `experiment` 最终写成什么样，Agent 的
   检查→必要时安装放在哪一步。

样例核对自 `laude-institute/terminal-bench` 的
`d28711d0da2675d0bb1d56de45ae5df6082438a3`。下文 API 是
PLAN-4 的候选调用面，不代表当前版本已经实现。

---

## 四道题为什么不能压成单 Sandbox

| Profile | 上游拓扑 | 题目依赖的隔离或网络语义 |
|---|---|---|
| `terminal-bench/broken-networking` | `client` | `dns: 192.0.2.1` 与错误 `extra_hosts` 就是待修故障；Dockerfile 还替换了 `curl`、`apt` 与 `nsswitch.conf` |
| `terminal-bench/debug-long-program` | `client` + `program` | `debug_server.py` 只挂进 `program`；Agent 必须经 `http://program:8008` 探测，不能读服务源码 |
| `terminal-bench/simple-sheets-put` | `client` + `api` + `db` | `client` 与 `api` 分别现场 build；`api` 经 Compose DNS 访问 Postgres，健康检查决定依赖就绪 |
| `terminal-bench/sql-injection-attack` | `client` + 两个服务 + 一次性初始化容器 | Agent 只看到漏洞客户端源码；数据库藏在共享卷，删除证据经只读 `deletion_logs` 投影回主容器 |

第四题也说明第一期不必为了判这批题就公开
`t.sandbox.services.exec()`。题目自己的 Compose 已把允许观察
的证据以只读卷投影给 `client`，隐藏数据库仍留在 sidecar。
`ServiceController` 先服务于 provider 采集状态和日志；只有
新的 eval 确实要主动进入 sidecar 判分时，才需要设计
author-facing 能力。

## 文件怎么放：一个 eval 就是一个文件夹

推荐把上游任务目录直接变成 eval 目录。新增的
`eval.ts` 是唯一入口，目录路径就是 eval id 与默认
environment profile id：

```text
evals/terminal-bench/
├── _lib/terminal-bench.ts
├── broken-networking/
│   ├── eval.ts
│   ├── Dockerfile
│   ├── docker-compose.yaml
│   ├── task.yaml
│   ├── run-tests.sh
│   └── tests/test_outputs.py
├── debug-long-program/
│   ├── eval.ts
│   ├── Dockerfile
│   ├── debug_server.py
│   ├── docker-compose.yaml
│   ├── task.yaml
│   ├── run-tests.sh
│   └── tests/test_outputs.py
├── simple-sheets-put/
│   ├── eval.ts
│   ├── api/...
│   ├── client/Dockerfile
│   ├── docker-compose.yaml
│   ├── task.yaml
│   ├── run-tests.sh
│   └── tests/test_outputs.py
└── sql-injection-attack/
    ├── eval.ts
    ├── Dockerfile
    ├── docker-compose.yaml
    ├── services/{init_db,master_service}.py
    ├── vulnerable_login.py
    ├── task.yaml
    ├── run-tests.sh
    └── tests/test_outputs.py
experiments/terminal-bench/
├── codex-docker.ts
└── codex-e2b-compose.ts
```

发现器新增明确约定：

```text
evals/foo.eval.ts       → id "foo"
evals/foo/eval.ts       → id "foo"
```

二者同在时报重名。`_lib` 没有 `.eval.ts` 入口，只是普通共享
代码，不会被发现成 eval。

上游的 `solution.sh`、生成器和参考答案不要放进可运行目录。
确实要为溯源共址时放 `reference/` 并声明 private；它必须从
所有 build context 排除，任何阶段都不上传。只做到“eval
没主动上传”还不够：Dockerfile 若有 `COPY . .`，同目录文件
仍可能进入镜像。

三类文件有不同归属：

| 文件 | 何时可见 | 身份 |
|---|---|---|
| Dockerfile、Compose、build context、相对 bind mount | 环境物化时交给 provider；Agent 只看到最终主容器视图 | BuildKey / CaseKey |
| `task.yaml` | 宿主发现期读 instruction、timeout、tags | eval 数据指纹 |
| `run-tests.sh`、`tests/**` | 最后一次 `t.send()` 返回后才上传主容器 | eval 判据指纹 |

普通起始 fixture 也可以同目录放在 `fixture/`，由 eval
`setup` 或 `test` 在 `send` 前上传，Agent 本来就应看见；
它进入 eval fixture 归因。目录共址只解决组织问题，不把
environment、fixture、verifier 三种生命周期揉成一个哈希。

发现期会将 loader 登记的 verifier/private 路径与 Compose
每个 build context 交叉检查。若仍在 Docker 发送闭包里，
必须通过 `.dockerignore` 或 environment 的 filtered-context 声明
排除，否则直接报泄题风险。过滤规则进入 BuildKey。不能用
“Dockerfile 现在看起来没 COPY 它”作为放行条件，因为后续
一行 `COPY . .` 就会静默改变题目。

三种修改应有不同结果：

- 改 `tests/test_outputs.py` 只作废判分口径，不要求重建镜像；
- 改 `debug_server.py` 改变 CaseKey，但 client BuildKey 命中；
- 改 `api/Dockerfile` 只让 api BuildKey cache miss，同时改变
  整组 CaseKey。

## `eval.ts`：环境来源与 eval 共址

四个入口都可以只有一行，公共 helper 用入口 URL 定位同目录
文件：

```typescript
// evals/terminal-bench/debug-long-program/eval.ts
import { defineTerminalBenchEval } from "../_lib/terminal-bench.ts";
export default await defineTerminalBenchEval(import.meta.url);
```

Helper 声明的是 Compose source，不选择 provider：

```typescript
// evals/terminal-bench/_lib/terminal-bench.ts
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import {
  loadCriteriaTree,
  loadText,
  loadYaml,
} from "niceeval/loaders";
import { composeEnvironment } from "niceeval/sandbox";

interface TaskYaml {
  instruction: string;
  tags?: string[];
  max_agent_timeout_sec: number;
  max_test_timeout_sec: number;
}

export async function defineTerminalBenchEval(entry: string | URL) {
  const root = new URL("./", entry);
  const name = basename(fileURLToPath(root));
  const task = await loadYaml<TaskYaml>(new URL("task.yaml", root));
  const runTests = await loadText(new URL("run-tests.sh", root));
  const tests = await loadCriteriaTree(new URL("tests/", root));

  return defineEval({
    description: `Terminal-Bench: ${name}`,
    tags: ["terminal-bench", ...(task.tags ?? [])],
    environment: composeEnvironment({
      file: new URL("docker-compose.yaml", root),
      mainService: "client",
      build: "on-demand",
      executionUser: "image",
      compatibility: "terminal-bench",
      hiddenInputs: [new URL("run-tests.sh", root), ...tests],
    }),
    timeoutMs:
      (task.max_agent_timeout_sec + task.max_test_timeout_sec) * 1_000,
    metadata: { benchmark: "terminal-bench", task: name },
    async test(t) {
      await t.send(task.instruction);

      await t.sandbox.uploadDirectory(
        fileURLToPath(new URL("tests/", root)),
        ".niceeval-verifier/tests",
      );
      await t.sandbox.writeFiles(
        { "run-tests.sh": runTests },
        ".niceeval-verifier",
      );

      t.check(
        await t.sandbox.runCommand("bash", ["run-tests.sh"], {
          cwd: ".niceeval-verifier",
          root: true,
          env: { TEST_DIR: "tests" },
        }),
        commandSucceeded(),
      );
    },
  });
}
```

`loadCriteriaTree(URL)` 是 folder-first 所需的候选补充：登记
该目录下的完整判据树并返回 file URL，不要求 helper 反向拼
项目根相对 glob。当前 `loadCriteria` 的字符串 glob仍保留，
适合跨目录或精细 include/exclude。两者都只能在发现期调用。

`hiddenInputs` 不重复计算判据指纹，只把已登记的隐藏路径交给
环境泄漏门核对。更理想的实现可以由发现器自动关联，不要求
作者重复传；这里把数据流写明，留待 API 调用点评审。

`composeEnvironment` 产出 folder-local environment requirement，
默认 profile id 从 `eval.ts` 所在目录推导，即
`terminal-bench/debug-long-program`。它不是
provider-specific materializer，也没有声称任意 provider
都支持 Compose。

Terminal-Bench compatibility adapter 为每个 attempt 生成
上游要求的镜像名、容器名与日志目录变量。变量名与适配器修订
进入 CaseKey；随机值只作为运行事实。它不改 `dns`、
`extra_hosts`、network、volume、bind mount 或 `depends_on`。

`executionUser: "image"` 同样不能省。Terminal-Bench 的 client
默认以 root 工作，`broken-networking` 要修改系统文件。
Provider 不能悄悄换成 UID 1000；云实现也要兑现等价权限面。

四题的解析结果应当是：

| 题 | BuildKey | 额外进入 CaseKey、但不触发对应镜像 build 的输入 |
|---|---|---|
| broken-networking | client | Compose 的坏 DNS / hosts 配置 |
| debug-long-program | client | `debug_server.py` bind mount、`python:3.13-slim-bookworm` digest |
| simple-sheets-put | client、api | Compose、`postgres:15` digest、健康检查 |
| sql-injection-attack | client | 三个 Python bind mount、两个 service image digest、共享卷与依赖条件 |

`task.yaml` 与 `run-tests.sh` 经 loader 进入这条 eval 的指纹；
判据树 loader 登记整棵测试树，增删或修改任意测试都会作废
旧结果。上传绝对路径只用于传输，不承担身份。判据上传发生在
`send` 后，`debug-long-program` 的 Agent 既看不到隐藏测试，
也始终看不到 sidecar 的 `debug_server.py`。

上游四份 `run-tests.sh` 都会安装 `curl`、`uv` 与 pytest，
所以 verifier 命令显式 `{ root: true }`。这不改变 Agent
做题时的权限；Agent 权限由 environment source 的
`executionUser` 决定。
验证命令产生的 venv 与依赖也发生在 Agent 窗口之后，不进入
Agent diff。

四个 folder eval 不能合并成一个 keyed record：一组扇出
Eval 共享同一个 `environment` 声明，而四题各有不同 profile。
独立薄文件让 id 与 profile 都稳定，公共驱动仍只有一份。

## Docker experiment：本地现场 build

```typescript
// experiments/terminal-bench/codex-docker.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import {
  dockerComposeMaterializer,
  dockerSandbox,
} from "niceeval/sandbox";

export default defineExperiment({
  description: "Terminal-Bench 四道真实 Compose 题：Codex + Docker",
  agent: codexAgent(),
  sandbox: dockerSandbox({
    environmentCases: {
      compose: dockerComposeMaterializer(),
    },
    build: {
      mode: "on-demand",
      maxConcurrency: 2,
      timeoutMs: 20 * 60_000,
    },
  }),
  evals: ["terminal-bench"],
  attempts: 1,
  maxConcurrency: 4,
  labels: { agent: "codex", provider: "docker" },
});
```

首次运行时，环境构建协调器按 BuildKey 去重：

- broken、debug、sql-injection 各 build 一个 client；
- sheets 分别 build client 与 api；
- `postgres:15` 和两个 Python service image 解析 digest、按
  Docker cache 拉取，不伪装成逐题 build；
- 同一道题跑多个 attempt 时不重复 build。

环境产物就绪后才创建 Compose project。主 Sandbox 是
`client`，因此 Codex Adapter 的 Ensure 在 client 中执行：
先检查精确版本；未预装才安装；复检通过后做题。它不会装进
宿主、Docker daemon 容器或 sidecar。

环境构建并发 `2` 与 attempt 并发 `4` 是两道闸。冷构建时间
记入 Run 的 `environmentBuilds`，不占四个 Agent attempt 位；
Compose create、Agent Ensure、做题和验证才进入 attempt
deadline。

## E2B experiment：只有完整 Compose case 才开放

```typescript
// experiments/terminal-bench/codex-e2b-compose.ts
import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import {
  e2bDinDComposeMaterializer,
  e2bSandbox,
} from "niceeval/sandbox";

export default defineExperiment({
  description: "Terminal-Bench 四道真实 Compose 题：Codex + E2B DinD",
  agent: codexAgent(),
  sandbox: e2bSandbox({
    template: "niceeval/compose-host-v1",
    environmentCases: {
      compose: e2bDinDComposeMaterializer(),
    },
    build: {
      mode: "on-demand",
      maxConcurrency: 8,
      timeoutMs: 30 * 60_000,
    },
  }),
  evals: ["terminal-bench"],
  attempts: 1,
  maxConcurrency: 32,
  labels: { agent: "codex", provider: "e2b-dind" },
});
```

这里 E2B template 只预装 Docker daemon、Compose 与基础
cache，不预烘四道题，更不预烘 241 道 `<题目 × Agent>`
组合。任务环境按 CaseKey/BuildKey 现场物化；Codex 仍在
返回的 client Sandbox 内 Ensure。官方 Codex template 只是
Ensure 更容易命中的优化，不是运行这些任务的前提。

如果 E2B 禁止 DinD、缺稳定内部网络或不能把文件 API 代理进
client，这个 experiment 就不存在。项目可以改用另一个完整
支持 Compose 的云 provider；不能降低题目语义来追求同一份
provider 清单全绿。

## 四题的端到端验收

### broken-networking

1. CaseKey 包含 Dockerfile、Compose 中的坏 DNS 与三条
   `extra_hosts`。
2. Codex 进入 client，具有镜像声明的 root 权限；不得由
   provider 先修网络。
3. 回合结束后上传测试，真实安装 curl，再验证
   `curl example.com`。
4. 删除 Compose 网络配置后题目应被视为定义变化，不能与
   原题比较。

### debug-long-program

1. `debug_server.py` 只挂在 program；client 的文件 API、
   Agent、eval verifier 都不能读它。
2. client 能解析 `program`，Agent 只能经两个 HTTP API 探测。
3. 修改 `debug_server.py` 改 CaseKey，但 client BuildKey
   仍命中。
4. verifier 从 client 请求测试端点并检查
   `/app/num_lines.txt`，program 在判分结束前保持存活。

### simple-sheets-put

1. client 与 api 各有一个 BuildKey，db 记录
   `postgres:15` 的实际 digest。
2. Compose 原生兑现 db→api→client 的健康检查链；未就绪时
   不把 client 交给 Agent。
3. Agent 只访问 `http://api:8000`，不能把 API/DB 合并进
   client 进程。
4. api 或 db 在评分前异常退出，attempt 是环境
   `errored`，并附对应服务日志。

### sql-injection-attack

1. client 只读看到 `/app/vulnerable_login.py` 和
   `/app/logs`；`master_service.py`、`init_db.py` 与数据库卷
   不得经主 Sandbox 文件 API 暴露。
2. 一次性 `db_init` 成功后 vulnerable service 才启动；
   Compose 的完成条件不能被导入器丢掉。
3. Agent 必须经网络 API 删除用户；verifier 读取题目主动
   暴露的只读日志并复查 API 状态。
4. 整组结束时删除服务、网络和两个 named volume；部分启动
   或中断也走同一个 finalizer。

## 由这些样例反推的实现边界

- NiceEval core 需要 environment case 生命周期、CaseKey、
  BuildKey 协调和主 Sandbox，不需要认识 Terminal-Bench
  task schema。
- Terminal-Bench compatibility helper 负责上游变量和目录
  约定，不负责解释或改写 Compose 网络语义。
- Eval folder 声明 environment source、题面与判据；不运行
  `docker compose build/up`，也不维护 template alias。
- Experiment 选择 Agent、provider materializer、构建并发与
  attempt 并发；不复制四道题的拓扑。
- Agent Adapter 只在 case 返回的主 Sandbox 做
  check→install→recheck；环境是否预装 Codex不改变 eval。
- Provider 不能完整兑现某 case 时应缺映射并在启动期失败。
  「不同 provider 有不同 case 集合」是诚实的能力边界，不是
  core 不通用。
