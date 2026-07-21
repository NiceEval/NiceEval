# Sandbox 的测试用例

本页是 Sandbox 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## 生命周期与资源释放

契约来源：[Architecture](../../../feature/sandbox/architecture.md)、[Library](../../../feature/sandbox/library.md)。

| 契约 | 场景 |
|---|---|
| attempt 调用链顺序固定：createSandbox → sandbox.setup 钩子链 → 分类账锚点 → EvalDef.setup → SandboxAgent.setup → test(t) → 折叠 agent 归因增量 → 评分/判定 → eval cleanup → SandboxAgent.teardown → sandbox.teardown → commitKeepOrStop | 正例：事件记录按序断言全链；边界：某钩子未定义时跳过但其余顺序不变 |
| setup 抛错时已成功 setup 的 cleanup 按逆序执行，teardown 链与 stop 仍被调用 | 反例：setup:b 抛错后 cleanup:a、teardown、stop 全跑；边界：第一个/最后一个抛 |
| test 失败或中断路径下 SandboxAgent.teardown → sandbox.teardown → stop 均为 finally 语义 | 反例：test 抛错；边界：teardown 自身抛错不阻断 stop |
| sandbox.setup 抛错按执行错误计（verdict `errored`）；sandbox.teardown 报错只记日志，不改变已完成判定 | 正例：setup 抛 → errored；反例：teardown 抛 → 结果不变且有日志 |
| 收尾链每个可调用体各有 30s 清理超时:挂起的 cleanup/钩子到点记 `teardown-failed` 诊断,后续段照常执行 | 反例:挂起的可调用体在小超时下抛超时错(机制在 cleanup-timeout 单测);超时错→诊断、后续段照常与「teardown 自身抛错不阻断 stop」同一路径(出处:memory/force-exit-skips-experiment-teardown.md) |
| 多次 `.setup()` 按追加顺序执行，多次 `.teardown()` 按追加逆序（LIFO） | 正例：3 setup + 2 teardown 顺序断言 |
| `.setup()` / `.teardown()` 返回新 spec，不修改原 spec | 正例：链式后原 spec 钩子数不变；边界：同基 spec 两条派生链互不影响 |
| 创建成功后被 provider 终止属 lifecycle failure，不进同实例 IO 重试，保留终止原因 | 反例：Sandbox terminated 不进重试循环 |
| remote 型 agent 下 experiment.sandbox 整体忽略，钩子不执行 | 正例：remote agent + 带钩子 spec 时钩子零调用 |
| hook 收到窄上下文（experimentId、signal、progress/diagnostic），不含完整 AgentContext；直跑 eval 时 experimentId 为 undefined | 正例：ctx 字段形状；边界：直跑时 undefined |

示例——setup 失败仍清理已获取资源，并按 LIFO teardown：

```ts
import { assert, it } from "@effect/vitest"
import { Effect } from "effect"

it.effect("setup 失败仍清理已获取资源，并按 LIFO teardown", () =>
  Effect.gen(function* () {
    const log: string[] = []
    const fx = sandboxLifecycleFixture({
      setup: [
        () => { log.push("setup:a"); return () => log.push("cleanup:a") },
        () => { log.push("setup:b"); throw new Error("boom") },
      ],
      teardown: [
        () => log.push("teardown:x"),
        () => log.push("teardown:y"),
      ],
      stop: () => log.push("stop"),
    })

    yield* Effect.exit(fx.run)

    assert.deepStrictEqual(log, [
      "setup:a",
      "setup:b",
      "cleanup:a",
      "teardown:y",
      "teardown:x",
      "stop",
    ])
  }),
)
```

## 路径规则

契约来源：[Library](../../../feature/sandbox/library.md)、[README](../../../feature/sandbox/README.md)。路径规则适合表驱动，每个 case 指向一条允许或拒绝语义。

| 契约 | 场景 |
|---|---|
| 沙箱侧相对路径解析到 workdir，绝对路径原样，省略 targetDir/cwd 默认 workdir | 表驱动三态；反例：hardcode `/workspace` 不被解析成 workdir |
| 解析规范化 `./` `../`；逃出 workdir 的路径拒绝抛错 | 正例：`./src/../src/a.ts`；反例：`../../etc/passwd` 抛错；边界：空串、`.`、尾斜杠 |
| targetDir/cwd 不做 shell 变量展开，`$HOME/workspace` 是字面目录 | 反例：$HOME 不展开；边界：含 `~` 的路径 |
| 本地侧相对路径解析到 eval 定义文件目录，与沙箱侧锚点独立 | 正例：`uploadDirectory("../workspaces/x")` 从 eval 文件目录解析 |

```ts
const workdir = "/home/sandbox/workspace"

it.each([
  { path: "src/a.ts", expected: "/home/sandbox/workspace/src/a.ts" },
  { path: "./src/../src/a.ts", expected: "/home/sandbox/workspace/src/a.ts" },
  { path: "../../etc/passwd", error: /workdir|outside/ },
])("解析 sandbox 路径 $path", ({ path, expected, error }) => {
  if (error) {
    expect(() => resolveSandboxPath(workdir, path)).toThrow(error)
  } else {
    expect(resolveSandboxPath(workdir, path)).toBe(expected)
  }
})
```

## 命令执行

契约来源：[README](../../../feature/sandbox/README.md)、[Architecture](../../../feature/sandbox/architecture.md)、[Library](../../../feature/sandbox/library.md)。

| 契约 | 场景 |
|---|---|
| runCommand 按 argv 传参不经 shell，含空格、`;`、`$`、反引号的参数原样送达 | 正例：参数边界/cwd/env/root 全透传；反例：`"a; rm -rf /"` 仍是一个参数 |
| 非零退出返回 `CommandResult`（exitCode ≠ 0），不抛基础设施异常；stdout/stderr 分离 | 正例：exit 7 → exitCode 7；边界：exitCode 0 + 有 stderr |
| `env` 叠加在沙箱默认环境之上，不清空默认值 | 正例：默认键仍在；反例：同名键覆盖而非合并失败 |
| root 默认 false；`{ root: true }` 映射 provider 原生机制；无法提 root 的 provider 抛错不静默降级 | 正例：docker/e2b/vercel 各自映射；反例：不支持时抛错 |
| runCommand、runShell、appendLog、stop 永不被包装层隐式重试 | 反例：抛 fetch failed 时底层只被调用一次 |
| 命令级超时到点销毁执行流并报错 | 反例：超时后 promise 以错误结算；边界：恰在超时前完成 |
| appendLog 可选：未实现时 no-op 不抛；stream 选项在不支持的 provider 被忽略 | 正例：实现了则被调；反例：未实现不抛 |

示例——参数透传能发现错误的 shell 拼接，断言 mock 被调用一次不能：

```ts
it("runCommand 保留参数边界、cwd、env 和 root 语义", async () => {
  const fx = recordingSandbox([
    { stdout: "ok", stderr: "", exitCode: 0 },
  ])
  const t = sandboxContextFixture(fx.sandbox)

  const result = await t.sandbox.runCommand(
    "pnpm",
    ["test", "--", "path with spaces"],
    { cwd: "packages/app", env: { CI: "1" }, root: false },
  )

  expect(result.exitCode).toBe(0)
  expect(fx.commands).toEqual([
    {
      command: "pnpm",
      args: ["test", "--", "path with spaces"],
      options: { cwd: "packages/app", env: { CI: "1" }, root: false },
    },
  ])
})
```

## 文件操作与 IO 重试

契约来源：[Architecture](../../../feature/sandbox/architecture.md)、[操作](../../../feature/sandbox/library/operations.md)、[README](../../../feature/sandbox/README.md)。重试用 `TestClock` 推进，不做真实等待。

| 契约 | 场景 |
|---|---|
| 仅幂等固定目标文件操作进入默认重试：瞬时传输错误（429、5xx、fetch failed、连接重置、临时 DNS）最多 3 次指数退避带抖动 | 正例：429 两次后成功共调 3 次；反例：第 4 次不再试 |
| 非瞬时错误（不存在、权限、路径错、取消、terminated）第一次即抛 | 反例：ENOENT 只调用一次；边界：取消信号在退避睡眠中触发立即抛 |
| fileExists 遇瞬时传输错误必须抛出，不伪装成 false | 反例：网络错误 ≠ false；正例：真实不存在 → false |
| 重试耗尽后抛回原始 error，错误链保留 | 反例：抛出的不是包装后的通用错误；边界：cause 链完整 |
| 批量写部分完成后重跑仍覆盖同一组目标，结果与一次成功等价 | 边界：写一半失败重试后内容正确且无多余文件 |
| readFile 读文本，不存在直接抛；downloadFile 返回 Buffer | 反例：不存在抛而非返回空串；正例：二进制逐字节一致 |
| readSourceFiles 返回 SourceFile[] 且挂 text()/code()/fileMatching/fileMatchingAll/hasPath；uploadDirectory 的 ignore 排除匹配文件 | 正例：各 helper 行为；边界：空目录、ignore 全排除 |

## Provisioning 失败与重试

契约来源：[Architecture](../../../feature/sandbox/architecture.md)。相关裁决与踩坑见 memory 的 [sandbox-provision-ratelimit-retry](../../../../memory/sandbox-provision-ratelimit-retry.md)、[provision-retry-holds-concurrency-slot](../../../../memory/provision-retry-holds-concurrency-slot.md) 与 [e2b-provision-429-duplicate-sandbox](../../../../memory/e2b-provision-429-duplicate-sandbox.md)。

| 契约 | 场景 |
|---|---|
| provider 原生限流错误归类为中性 kind `rate_limit`；provider 没认出的错误兜底走与文件 IO 共用的瞬时分类器，传输层瞬时错误同样可重试；createProvider 对可重试 kind 指数退避（封顶+抖动），确定性错误第一次即抛 | 正例：三家原生限流各自归类、create 期间 `fetch failed`／连接重置进入重试；反例：凭据错误、模板不存在零重试 |
| 退避睡眠期间临时归还并发槽位，睡醒后重新排队，不占着 sandboxSem 陪跑；create 首次成功或遇不可重试错误时全程不触碰槽位 | 正例：一批 429 期间其它 attempt 能获得槽位；反例：成功或不可重试错误路径下 release/reacquire 均未被调用 |
| 有对账通道时任何重试前都对账，不分拒绝类（如 `rate_limit`）与歧义类；对账排在退避睡眠之后（睡醒再查）；对账失败即放弃重试并抛回原始 create 错误，不抛对账错误；无对账通道时歧义类错误第一次即抛不重试（[bug 台账](../../../../memory/e2b-provision-429-duplicate-sandbox.md)：`create()` 闭包内 SDK create 成功后的初始化请求撞 429 曾被当拒绝类盲重试，同一 provision token 开出两台实例） | 正例：`rate_limit` 携对账通道时顺序为 create→对账→retry create；反例：无对账通道时歧义类错误零重试；反例：对账通道抛错时重试终止、attempts 保持 1 且抛出的是原始 create 错误 |
| 重试耗尽后 verdict `errored`；defineSandbox 自定义 provider 的 create 不套用这层重试 | 反例：自定义 provider 抛限流只调一次 |

## diff 与结果断言

契约来源：[Architecture](../../../feature/sandbox/architecture.md)、[结果断言](../../../feature/sandbox/library/asserting-results.md)、[CLI](../../../feature/sandbox/cli.md)。

| 契约 | 场景 |
|---|---|
| 分类账锚点打在 sandbox.setup 钩子链之后，环境层钩子写入的文件不出现在 agent diff；send 窗口外的 fixture / 校验写入同样不在，send 窗口内的变化在 | 反例：setup 与 test() 写的 fixture 不在 agent diff；正例：send 窗口内 agent 写入的在；反例：send 之后手工写入的隐藏校验文件不在 |
| `sandbox history` / `sandbox diff` 打印的窗口标签与证据面的[轮标签](../../../feature/scoring/library/display.md#turntsend的展示)是同一枚 token；`--window` 按字符串等值匹配打印出的标签，不解析标签内部结构 | 正例：history 行的 `turn2` 原样作 `--window turn2` 命中同一窗口；边界：`session2/turn1` 同规则命中；反例：未命中任何窗口时报错并列出可用标签 |
| 分类账默认排除与 `diff.ignore/include` 按 workdir 根的 gitignore 风格 glob 在任意深度生效；未排除的 nested repo / submodule 不得以 gitlink 静默吞掉内部改动 | 正例：嵌套 `node_modules` / `__pycache__` 默认不进账且 include 可打洞；反例：mode 160000 立即报错并提示 checkout 放 workdir 根或整体 ignore；边界：显式 ignore 的 nested repo 不报错 |
| `noFailedShellCommands` 只统计 Agent 自己发起的 shell 调用，不看 eval 手工跑的验证命令 | 反例：eval 的 runCommand 失败不触发；正例：agent shell 非零退出触发 |
| fileChanged/fileDeleted/notInDiff 是延迟断言对最终 diff 求值；`file(path)` 在 finalize 时才读取 | 正例：注册时不读文件；反例：fileDeleted 对仅修改的文件不通过 |
| diff.get/isEmpty/matches 读取最终工作区变化 | 正例：get 返回单文件 diff；边界：无改动时 isEmpty true |

## provider 选择与作者面

契约来源：[Library](../../../feature/sandbox/library.md)、[操作](../../../feature/sandbox/library/operations.md)、[README](../../../feature/sandbox/README.md)。

| 契约 | 场景 |
|---|---|
| sandbox 字段不接受裸字符串、无默认值、不自动探测；experiment 与 config 两处皆空时 resolveSandbox 抛错；experiment 未设回退 config | 反例：两处皆空抛错且指明下一步；正例：config 兜底；边界：experiment 覆盖 |
| spec 上有 create 即直接调用（defineSandbox 路径）；内置 spec 归一化后按 provider 派发；recommendedConcurrency 省略默认 5 | 正例：自定义 provider 无需注册名字；反例：核心路径无 provider 名分支 |
| `t.sandbox` 不暴露 stop；remote agent 上首次调用 `t.sandbox.*` 报错须指出具体 API 名和 agent 名 | 反例：类型上无 stop；正例：错误信息含 "readFile" 与 agent 名 |
| provider create 与 hook 的 progress/diagnostic 经反馈管线而非 stdout；调用方不能指定 phase | 正例：hook 内 progress 归属 sandbox-setup 阶段；边界：dedupeKey 去重 |

## Checkpoint（运行时快照归档）

契约来源：[预制环境 · 运行时 checkpoint](../../../feature/sandbox/library/prebuilt-environments.md#运行时-checkpointcreatecheckpoint--restorecheckpoint)。`createCheckpoint` / `restoreCheckpoint` 是 provider 无关的 tar 打包/还原工具，只依赖 `runShell` / `downloadFile` / `uploadFile` 三个方法。

| 契约 | 场景 |
|---|---|
| `createCheckpoint` 打包失败（tar 非零退出）直接抛错，不下载残缺归档冒充成功 checkpoint；`restoreCheckpoint` 解压失败同样直接抛错，临时归档文件按 finally 语义清理不受失败影响 | 反例：tar 打包非零退出 → 抛 "checkpoint archive failed" 且 `downloadFile` 未被调用；反例：tar 解压非零退出 → 抛 "checkpoint restore failed" 但清理命令 `rm -f` 仍执行 |

## Local provider

契约来源：[本地执行](../../../feature/sandbox/local.md)。

| 契约 | 场景 |
|---|---|
| `localSandbox()` 省略 `dir` 时从 cwd 向上解析 git 仓库根;不在仓库内报错并指明两条出路(进入仓库或传 `dir`);显式 `dir` 可为非 git 仓库的任意目录 | 正例:仓库子目录内解析到根;反例:仓库外报错含下一步;边界:显式 `dir` 指向非 git 目录仍可创建 |
| `runCommand` 在 workdir 起宿主进程且 argv 不经 shell,`env` 叠加宿主默认环境;`{ root: true }` 报错说明本地档不提权 | 正例:含 `;` 的参数只作为普通 argv 值;反例:`root: true` 报错并指向容器 provider |
| 只观察不还原:agent 写入落真实工作树且进 agent diff;用户 `.git`(HEAD / index / 未提交改动)全程不被触碰;`stop()` 只清 runner 私有资源,不删除、不还原工作树任何文件 | 正例:diff 采到且用户 git 状态逐字节不变;反例:`stop()` 后 agent 写入的文件仍在 |
| `--keep-sandbox` 与 local 组合在创建前报错,不先起实例 | 反例:报错发生在 create 之前且说明现场天然留在工作树 |

## 不这样测

- 不在 Context 测试里重新实现一个会执行真实 shell 的 fake Sandbox。
- 不断言 Docker SDK、Vercel SDK 或 E2B SDK 的构造器本身工作。
- 不只测 happy path；资源泄漏通常出现在失败和中断。
- 不允许未实现的 fake 方法静默返回空字符串、空数组或成功结果。
- 不在单测里连真实容器验证连通性；真实 provider 行为归 E2E 沙箱仓库。
