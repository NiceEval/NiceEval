# Sandbox —— CLI:留存现场与清理

跑完的沙箱默认销毁,debug 证据靠 artifact([Results](../results/architecture.md))。但有三类问题 artifact 结构性地回答不了,只能靠留住活现场:

- **环境类 `errored` 恰好证据最薄**——setup 链装包失败、agent CLI 起不来时,agent 根本没跑,`events.json` / `trace.json` 不存在,手里只有 error 摘要和 phases 计时;而这正是最需要进环境里手动重跑一遍命令的场景。
- **agent diff 之外是盲区**——artifact 采的是 workdir 内按 send 窗口归因的变更;全局装了什么、`$HOME` 下写了什么配置、PATH 实际长什么样,采不到。
- **复现成本是分钟级**——冷启动 + 安装每轮几分钟,每验证一个假设重跑一轮太慢;留下的现场把这个循环压到秒级。

为此 CLI 提供一对能力,合起来是留存沙箱的完整生命周期:`--keep-sandbox` 在 run 侧**留下**现场,`niceeval sandbox` 命令组在事后**查看与销毁**它们。

## `--keep-sandbox`:跑完留下现场

`--keep-sandbox` 是 `niceeval exp` 的运行 flag,不是独立命令——留存是"这次怎么跑"的一部分,挂在唯一会创建沙箱的命令上:

```bash
niceeval exp local onboarding/tool-first --keep-sandbox        # = --keep-sandbox=failed
niceeval exp local onboarding/tool-first --keep-sandbox=all    # passed 也留,调环境用
```

- 两档语义:`failed`(缺省值,裸 `--keep-sandbox` 等价)留 verdict 为 `failed` / `errored` 的 attempt——包括被硬超时打断的 `errored`(这是最高价值的现场);`all` 连 `passed` 也留,用于调 setup 钩子、核对通过环境的真实状态,不用故意弄挂一条 eval 才能拿到现场。默认(不带 flag)全部销毁——CI、并发与云资源管理不允许无主现场,留存永远是显式选择。
- debug 流程的典型形态是「这条挂了,重跑这一条」,配合 eval 前缀位置参数收窄范围,天然不会一次留下几十个容器。
- 符合 CLI 输入模型:位置参数选 experiment 路径与 eval,flag 说怎么跑。
- 留存只跳过销毁这一步:`teardown` 钩子链照常执行(环境层回存状态不因 debug 被跳过),留下的现场是收尾完成后的状态。对应地,该 attempt 的 `phases` 以 `sandbox.suspend` 结尾而没有 `sandbox.stop` 条目——留存提交后现场转入 provider 的休眠形态(docker 停驻容器、e2b pause、vercel stop 后可恢复),不白烧资源;suspend 失败时现场保持运行并记 diagnostic,仍被注册表管理。语义见 [Architecture · 各 provider 的留存语义](architecture.md#留存keep与注册表)。
- 被中断的 run 不留存:留存授予发生在 verdict 定稿的收尾点,Ctrl+C 时还没有 verdict 的 attempt 走正常清理;此前已完成并授予留存的沙箱不被中断收回。
- 留存的沙箱永不进入跨 case 复用链(现场必须属于那一次 attempt,被 `git clean` 重置过就没意义了);`--keep-sandbox` 生效时该 run 的沙箱复用关闭,预热池行为不变(未领用的池内沙箱照常销毁)。

### run 收尾输出

留存发生时,run 摘要后追加输出,三种 profile 都有、格式随 profile。`human` 是一个面板——它与 `FAILED` / `FAILURES` / `NEXT` 同属 [`exp` 结束反馈的框线体裁](../experiments/cli.md#框线体裁):留存条数嵌上边框右侧,批量清理命令嵌下边框,与 `show` 把下钻命令嵌在证据框下边框同一条规则——命令紧贴它作用的那块内容:

```text
╭─ KEPT SANDBOXES ────────────────────────────────────────────────────── 2 kept ─╮
│ @1x7f3q9k  onboarding/tool-first #1  errored  docker · a3f9c2d1                │
│            enter: niceeval sandbox enter a3f9c2d1                              │
│ @1x7f3q8a  onboarding/tool-first #2  failed   docker · b81e07aa                │
│            enter: niceeval sandbox enter b81e07aa                              │
╰────────────────────────────────────────────────── niceeval sandbox stop --all ─╯
```

`agent` 在 stderr 追加单行事件(与 run 事件同一 `key=value` 词法),并在 handoff block 的 `next:` 里补 `niceeval sandbox stop --all`:

```text
NICEEVAL kept locator=@1x7f3q9k eval=onboarding/tool-first attempt=1 verdict=errored provider=docker sandbox=a3f9c2d1 enter="niceeval sandbox enter a3f9c2d1"
```

`ci` 在 stderr 追加人读单行:

```text
niceeval: kept sandbox a3f9c2d1 (docker) — onboarding/tool-first #1 errored — enter: niceeval sandbox enter a3f9c2d1
```

每条都给三样东西:attempt 定位符(接 `niceeval show @…` 看落盘证据)、provider 与实例 id、进入现场的命令。进入统一走 `niceeval sandbox enter`(见下),不让用户背各家 provider 的语法;provider 原生命令记在注册表里供直连。

### 残留提醒

`niceeval exp` 启动时若注册表里还有上次留下的沙箱,打一行提醒(不阻塞、不清理):

```text
2 kept sandboxes from earlier runs — niceeval sandbox list
```

## `niceeval sandbox`:查看与销毁留存的沙箱

```bash
niceeval sandbox list                                  # 列出全部留存沙箱及其现场状态
niceeval sandbox enter <id>                            # 唤醒并进入现场;退出后自动回到休眠
niceeval sandbox history <id>                          # 逐窗口列出现场里的变更历史
niceeval sandbox diff <id> [--window turn2] [--path <file>]   # 某个窗口 / 某个文件的 patch
niceeval sandbox stop <id...>                          # 销毁指定沙箱(接受实例 id 或其唯一前缀)
niceeval sandbox stop --all                            # 销毁全部留存沙箱
```

`sandbox` 命令组不读 `niceeval.config.ts`、不发现 eval,只操作留存注册表(`.niceeval/sandboxes/` 下的逐条目文件,见 [Architecture · 留存注册表](architecture.md#留存keep与注册表))与内置 provider 的 detached 能力。

**输出体裁**:`sandbox` 命令组是一次性读取命令——一次调用、打印、退出,没有「运行中」阶段,因此不设 `exp` 的 [`--output` 三分](../experiments/cli.md#三种反馈模型):那三种反馈模型区分的是长时运行的反馈节奏,不是一次性输出的格式。人读与机器读的区分由传输能力承担:stdout 是 TTY 时,`list` / `history` 这类有边界、可整体阅读的输出按[区域框](../reports/library/layout.md#区域框text-面的框线体裁)渲染为面板——标题嵌上边框左侧、规模嵌右侧、下钻命令嵌下边框;非 TTY(agent 捕获、管道、重定向)按同一契约降级为无框纯文本,内容与顺序一字不变。框只是呈现层:字段、缩进与提示行在两种形态下逐字相同,脚本不解析框字符,注册表条目文件才是程序消费的权威数据。`diff` 的 patch hunk 与 `stop` 的确认行是逐条流事件,按体裁不画框。

**注册表发现**:从当前目录向上找最近的 `.niceeval/`(与结果根发现同一规则),所以在项目任何子目录里执行 `sandbox enter/list/stop` 都命中同一份注册表——run 摘要里打出的 enter 命令不因 `cd` 失效;在仓库外执行时用 `--results <结果根>` 显式指定,找不到注册表时报错并提示这条路径,不静默返回空列表。

**条目级 lease**:`enter` 在唤醒前把 `{ holder: <pid@host>, op, acquiredAt, ttl }` 写进条目(原子 rename,与条目写入同一机制),退出并重新休眠后释放。持有 lease 期间,`stop` 与另一个 `enter` 对同一条目直接拒绝并报出 holder(「in use by pid 4242@mbp since …」),不会把别人还开着 shell 的现场 suspend 或销毁;`history` / `diff` 只读,可与 enter 并存但不改变休眠状态的归属——现场的唤醒 / 回眠始终由 lease holder 负责。进程崩溃留下的过期 lease(超 TTL)允许下一个命令强占并如实提示。`stop` 的语义与 `Sandbox.stop()` 一致:销毁——休眠不是 stop 的一种,是留存现场的常态形态。正因为事后命令不执行用户项目代码,`defineSandbox` 自定义 provider 不支持 `--keep-sandbox`;组合使用会在创建沙箱前报错。

### `sandbox enter`

进入现场的唯一日常入口,把三家 provider 的差异收干净:

1. 按注册表条目路由 provider,现场休眠中则先唤醒(docker `start`、e2b `resume`、vercel 恢复);`expired` 条目直接报错并给出 `stop` 清理建议。
2. 在 `workdir` 打开交互 shell。
3. shell 退出(含 Ctrl+C)后自动把现场送回休眠——「休眠不烧资源」的承诺不因为进去看过一眼就失效;要让它保持运行,显式传 `--leave-running`。
4. 把观察到的现场状态回写注册表条目(`state`),`list` 的显示保持新鲜。

### 回放留存现场的变更历史:sandbox history / diff

attempt 落盘的 `diff.json` 是折叠后的 agent 归因增量;留存现场里还保有完整的逐窗口账本,这两条命令是它的公开出口(现场休眠中同样先唤醒、读完送回休眠;现场销毁后账本随之消失,artifact 不受影响):

```text
$ niceeval sandbox history a3f9c2d1
╭─ HISTORY · a3f9c2d1 ────────────────────────────── anchor 2026-07-14 15:00:12 ─╮
│ eval    +3 files            (fixture / setup)                                  │
│ turn1   agent   M manager_decisions.json                                       │
│ eval    +1 file             (post-send validation)                             │
│ turn2   agent   M manager_decisions.json · A notes/decision-log.md             │
╰──────────────────────────────── niceeval sandbox diff a3f9c2d1 --window turn2 ─╯
```

变更基线锚点嵌上边框右侧,窗口逐行列在框内,下边框嵌下一步的 `diff` 命令(带最近一个窗口,改参数即可换窗口)。

```text
$ niceeval sandbox diff a3f9c2d1 --window turn2 --path notes/decision-log.md
A notes/decision-log.md · window turn2
@@ -0,0 +1,18 @@
+# Decision log
+…
```

窗口标签与 `show --timing` / `--execution` / `diff.json` 的[轮标签](../scoring/library/display.md#turntsend的展示)是同一枚 token,`--window` 按字符串等值匹配打印出的标签;`--window` 省略时输出全部窗口的串联视图,`--path` 省略时输出该窗口的全部文件。

### `sandbox list`

```text
$ niceeval sandbox list
╭─ SANDBOXES ─────────────────────────────────────────────────────────── 2 kept ─╮
│ ID        PROVIDER  STATE     FROM                                             │
│ a3f9c2d1  docker    dormant   onboarding/tool-first #1 · errored · @1x7f3q9k   │
│           2026-07-14 15:02 · enter: niceeval sandbox enter a3f9c2d1            │
│ 9f21c07b  vercel    expired   onboarding/tool-first #2 · failed  · @1x7f3q8a   │
│           expired 2026-07-14 14:36 — remove: niceeval sandbox stop 9f21c07b    │
╰────────────────────────────────────────────────────────────────────────────────╯
```

- 留存总数嵌上边框右侧;下边框不嵌命令——每个现场的下一步动作各不相同,批量 `stop --all` 不能当所有条目的默认下一步。
- 提示行缩进在所属条目下面,不共用——每个现场的下一步动作(enter / remove)各自成行,紧跟身份行。
- `STATE` 是当下核对的现场状态:`alive` 在跑(suspend 失败或 `--leave-running` 留下的)、`dormant` 休眠中可唤醒(docker 停驻、e2b 已 pause、vercel 已 stop)、`expired` 现场已经没了、只剩注册表记录(vercel 保留期限已过,或实例被外部删除)。docker 问本地 daemon,云 provider 按注册表的 `expiresAt` 与实例状态核对。
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
- `stop` 走内置 provider 的 detached 销毁通道(不需要原来的 run 进程还活着)。只有实例成功销毁或确认已不存在时才移除登记项;provider 返回其它错误时保留条目并退出 1,方便重试,不能把仍活着的资源从管理面隐藏掉。

## 与 artifact 的分工

留存现场不替代 artifact:判定、断言、diff、事件与计时仍以落盘为准(`niceeval show @<locator>` / `niceeval view`),现场用来回答落盘之外的问题——「这个命令在那个环境里到底怎么失败的」「agent 往 workdir 外写了什么」。留存的沙箱不是可续跑状态,没有续跑 / 重评语义——provider 的休眠唤醒只恢复现场供人进去看,不恢复 eval 运行。

## 相关阅读

- [README](README.md) —— 为什么需要沙箱、provider 统一接口。
- [Architecture](architecture.md) —— 留存决策在 attempt 收尾链里的位置、注册表、各 provider 的留存语义。
- [Results · `result.json`](../results/architecture.md#resultjson) —— `sandbox` 字段(provider、实例 id、是否留存)。
- [CLI 内部架构](../../cli.md) —— 命令分派、中断路径与「不留无主沙箱」。
