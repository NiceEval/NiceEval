# E2B Provider —— 架构

E2B Provider 的实现。公开用法见 [E2B](../../library/providers/e2b/README.md)；所有 Provider 共用的契约见 [Architecture](../README.md)。

## 实例与命令

需要 `E2B_API_KEY`(team 级;`e2b auth login` 后 CLI 也会用它)。要点:

- `E2BSandbox.create({ template, timeout })` 起一台 [E2B](https://e2b.dev) 微 VM;`template` 由 `e2bSandbox({ template })` 声明,必填(见 [Sandbox Layer](../../library/layers.md#template-bearing-factory)),不用 e2b 账号侧的默认模板。
- 命令经 `commands.run`(走 bash,支持 `&&` / 管道);`user` 直接透传 `commands.run` 的同名参数。
- `commands.run` 的 event stream EOF 不是直接 shell 的完成边界。正常 shell 已退出、但 `nohup ... &` 等任务服务仍持有 stdout/stderr 时，provider 采集前台输出与 exit code 后断开 transport；它不等待该服务退出，也不杀它。完成帧只接受 supervisor 在取得子进程状态后写出的十进制 exit code，wrapper 源码、转义诊断或子进程回显中出现的 marker 字面量都不是完成边界。timeout、取消、协议完整性失败或 interruption 仍退休整台 VM，避免未确认终止的命令树进入 reuse / keep。
- 文件用 `files.read` / `files.write`(文本 + 二进制)。
- node 版本由模板决定 —— `runtime` 字段对 e2b 仅作说明。要 node24 / 烘焙好 agent CLI,用预制模板 `e2bSandbox({ template: "niceeval-agents" })`——参数的典型用途正是把 agent CLI 烘焙进模板,让后续 eval 跳过安装直接开跑(构建工作流见 [Library · 预制实例](../../library/prebuilt-environments.md))。
- Before cache 的 Base 身份是 template 引用当前指向的 build，而不是 template 名字；同名 template 重建会产生新 build，旧前缀不得命中。规则见 [远端 snapshot Before cache · E2B](#远端-snapshot-driver)。

## 远端 snapshot driver

协议与 core 的捕获步骤见 [远端 snapshot Before cache](../remote-snapshot-cache.md)。E2B driver 交出的原语：

- **driver**：`preserves = { disks: ["/"], memory: true }`；`sourceUsableAfterSnapshot = true`。
- **Base 身份**：查询 `template` 引用当前指向的 build。`name` 取 `default` tag，`name:tag` 取对应 tag，经 `Template.getTags(name)` 得到 `buildId`；`baseIdentity` 是 `e2b-build:<buildId>`。template 或 tag 不存在时返回 `Ineligible(base-image-unverified)`；网络或服务错误是 `BeforeCacheSnapshotError`。
- **Base 确认的局限**：E2B 不在实例信息里返回 buildId，也不能按 buildId 创建实例，core 只能靠 staging ready 后的第二次查询确认。tag 在两次查询之间被改走又改回时无法发现。前提是作者在 Run 期间不移动所用 tag；需要更强保证时，template 引用应指向只构建一次的专用 tag。
- **Base 回退**：回退实例从声明的 template 引用创建，可能落在更新的 build 上；回退后 Attempt 真实执行全部 before，结果与不使用缓存相同。
- **execution domain**：`hash(规范化 API domain, sha256(E2B_API_KEY))`。换 key 等同于换 domain。
- **createSnapshot**：`Sandbox.createSnapshot(sandboxId, { name, mode: "full" })`，`mode` 进入 artifact format identity。
- **findSnapshot**：`Sandbox.listSnapshots({ sandboxId })` 后按名称精确匹配。
- **createFromSnapshot**：`Sandbox.create(snapshotId)`。

## Provisioning 对账与重试

通用分类与两道防线见 [Architecture · Provisioning 失败与重试](../README.md#provisioning-失败与重试)。

- **E2B** —— create 经 `metadata` 打 provision token,对账走 SDK 实例列表的 metadata 过滤,查到即 kill(实例已不存在视作对账完成)。创建成功后的工作区准备命令失败由 kill-on-failure 先 kill 再抛。真实跑分中两类都出现过:`Sandbox.create` 阶段的 `fetch failed · other side closed`(歧义类),与创建成功之后初始化请求撞 429 被归入拒绝类(反例见 memory 的 e2b-provision-429-duplicate-sandbox 条目)。都由重试前对账兜住。
