# Sandbox —— CLI:留存现场与清理

跑完的沙箱默认销毁,debug 证据靠 artifact([Results](../results/architecture.md))。但有三类问题 artifact 结构性地回答不了,只能靠留住活现场:

- **环境类 `errored` 恰好证据最薄**——setup 链装包失败、agent CLI 起不来时,agent 根本没跑,`events.json` / `trace.json` 不存在,手里只有 error 摘要和 phases 计时;而这正是最需要进环境里手动重跑一遍命令的场景。
- **git diff 之外是盲区**——artifact 采的是 workdir 相对 git 基线的 diff;全局装了什么、`$HOME` 下写了什么配置、PATH 实际长什么样,采不到。
- **复现成本是分钟级**——冷启动 + 安装每轮几分钟,每验证一个假设重跑一轮太慢;留下的现场把这个循环压到秒级。

为此 CLI 提供一对能力,合起来是留存沙箱的完整生命周期:`--keep-sandbox` 在 run 侧**留下**现场,`niceeval sandbox` 命令组在事后**查看与销毁**它们。

## `--keep-sandbox`:跑完留下现场

```bash
niceeval onboarding/tool-first --agent claude --keep-sandbox         # failed / errored 的 attempt 留存
niceeval onboarding/tool-first --agent claude --keep-sandbox=always  # 全部留存(看通过 case 的环境)
```

- 裸 flag 等价于 `--keep-sandbox=failed`:verdict 为 `failed` 或 `errored` 的 attempt 留存沙箱——包括被 attempt 硬超时打断的 `errored`(这是最高价值的现场)。debug 流程的典型形态是「这条挂了,重跑这一条」,配合位置参数选 eval,天然不会一次留下几十个容器。
- `always` 给环境开发用:沙箱 spec / setup 钩子还在调,run 通过与否都想进去看。
- 符合 CLI 输入模型:位置参数选 eval,flag 说怎么跑。`=<value>` 形式与 `--diff=<path>` 同属可选值 flag,在表驱动解析前统一预扫(见 [CLI 内部架构](../../cli.md#flag-解析表驱动单源))。
- 留存只跳过销毁这一步:`teardown` 钩子链照常执行(环境层回存状态不因 debug 被跳过),留下的现场是收尾完成后的状态。对应地,该 attempt 的 `phases` 没有 `sandbox.stop` 条目。
- 被中断的 run 不留存:留存授予发生在 verdict 定稿的收尾点,Ctrl+C 时还没有 verdict 的 attempt 走正常清理;此前已完成并授予留存的沙箱不被中断收回。
- 留存的沙箱永不进入跨 case 复用链(现场必须属于那一次 attempt,被 `git clean` 重置过就没意义了);`--keep-sandbox` 生效时该 run 的沙箱复用关闭,预热池行为不变(未领用的池内沙箱照常销毁)。

### run 收尾输出

留存发生时,run 摘要后追加一段(human / agent / ci 三种 profile 都输出,格式随 profile):

```text
Kept sandboxes (2)
  @1x7f3q9k  onboarding/tool-first #1  errored  docker · a3f9c2d1
             enter: docker exec -it a3f9c2d1 bash
  @1x7f3q8a  onboarding/tool-first #2  failed   docker · b81e07aa
             enter: docker exec -it b81e07aa bash
Stop them with: niceeval sandbox stop --all
```

每行给三样东西:attempt 定位符(接 `niceeval show @…` 看落盘证据)、provider 与实例 id、进入现场的命令。进入命令由 provider 给出,不让用户去背各家语法。

### 残留提醒

`niceeval exp` 启动时若注册表里还有上次留下的沙箱,打一行提醒(不阻塞、不清理):

```text
2 kept sandboxes from earlier runs — niceeval sandbox list
```

## `niceeval sandbox`:查看与销毁留存的沙箱

```bash
niceeval sandbox list              # 列出全部留存沙箱及其存活状态
niceeval sandbox stop <id...>      # 销毁指定沙箱(接受实例 id 或其唯一前缀)
niceeval sandbox stop --all        # 销毁全部留存沙箱
```

`sandbox` 命令组不读 `niceeval.config.ts`、不发现 eval,只操作留存注册表(`.niceeval/sandboxes.json`,见 [Architecture · 留存注册表](architecture.md#留存keep与注册表))。`stop` 的语义与 `Sandbox.stop()` 一致:销毁,没有暂停态。

### `sandbox list`

```text
$ niceeval sandbox list
ID        PROVIDER  STATE            FROM
a3f9c2d1  docker    alive            onboarding/tool-first #1 · errored · @1x7f3q9k · 2026-07-14 15:02
9f21c07b  e2b       expired          onboarding/tool-first #2 · failed  · @1x7f3q8a · 2026-07-14 14:31
  enter: docker exec -it a3f9c2d1 bash
  stop:  niceeval sandbox stop a3f9c2d1   |   niceeval sandbox stop --all
```

- `STATE` 是当下核对的存活状态:docker 问本地 daemon;云 provider(e2b / vercel)按各自的 TTL 判断——它们的留存沙箱到点自然过期,`expired` 表示现场已经没了,只剩注册表记录。
- 没有留存沙箱时输出 `No kept sandboxes.`,退出码 0。
- `list` 只读,不清理任何东西——包括 `expired` 条目;条目的移除只发生在 `stop`。

### `sandbox stop`

```text
$ niceeval sandbox stop a3f9c2d1
stopped a3f9c2d1 (docker)

$ niceeval sandbox stop --all
stopped a3f9c2d1 (docker)
9f21c07b (e2b) already gone — removed from registry
```

- 幂等:实例已不存在(手动删过、云端过期)不算错误,移除注册表条目并如实说明。
- id 接受唯一前缀;有歧义或不在注册表里时报错并列出候选,退出码 1。
- 不带参数也不带 `--all` 时报错:`specify sandbox ids or --all`。
- `stop` 走 provider 的 detached 销毁通道(不需要原来的 run 进程还活着);`defineSandbox` 自定义 provider 未声明该能力时,`stop` 移除条目并提示需按该 provider 的原生方式手动清理(见 [Architecture · 留存与注册表](architecture.md#留存keep与注册表))。

## 与 artifact 的分工

留存现场不替代 artifact:判定、断言、diff、事件与计时仍以落盘为准(`niceeval show @<locator>` / `niceeval view`),现场用来回答落盘之外的问题——「这个命令在那个环境里到底怎么失败的」「agent 往 workdir 外写了什么」。留存的沙箱不是可续跑状态,没有 resume / 重评语义。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Architecture](architecture.md) —— 留存决策在 attempt 收尾链里的位置、注册表、各 provider 的留存语义。
- [Results · `result.json`](../results/architecture.md#resultjson) —— `sandbox` 字段(provider、实例 id、是否留存)。
- [CLI 内部架构](../../cli.md) —— 命令分派、可选值 flag 预扫、中断路径与「不留无主沙箱」。
