# Example 草稿问题与定稿规则

首轮草稿的价值不是文件数量，而是让错误写法暴露出来。父 agent 按“能否运行、旧实现是否会红、失败能否定位、
是否依赖真实用户边界”验收后，删除平铺版本，只保留 `repos/**` 下的独立场景 Repo。

| 草稿问题 | 为什么会假绿或反复改 | 当前规则与代码 |
|---|---|---|
| 用 `mechanism-unit/` 或 `cli-results.test.ts` 给一组异质测试命名 | 名字只说抽象类别，看不出 owner、用户动作或失败边界；同目录会持续吸入无关 case | 顶层只分 `unit/` 与 E2E `repos/`；Unit 按 Feature、E2E 文件按行为命名，CLI 已拆为 selection、streams-and-exit、show-json-pipe |
| 多个 adapter 共用一个 package / 结果根 | 不能证明各自真实依赖、安装、secret 与协议 | 每个 adapter 一个叶子 Repo；local protocol 不冒充 live |
| 把相似风险都标成历史 regression | 新测试可能杀不死历史旧实现 | 只有存在旧实现 kill 证据才写 `regression:`，否则写 `risk:` |
| CommonJS test 在 `/tmp` 临时造未安装项目 | `pnpm exec niceeval` 的实际 binary owner 不确定 | CommonJS 叶子本身就是 consumer，由 runner 注入候选 tarball |
| 根据 locator 自己拼导出路径 | 测的是测试作者的猜测，不是页面交付 | 从真实 anchor 读取 `href`，导航并核对同一 locator |
| 发明不存在的 aria / tooltip | selector 很精确，但产品根本没承诺 | 只用产品已有 role / label / 可见文本；缺失则报告可测试性 gap |
| 修改共享 config 后在 `finally` 写回 | crash、并行、watcher 会看到中间态 | mutation 只发生在每例私有 Repo 副本 |
| SIGINT 后只检查父 PID | backend、container、session 仍可能泄漏 | 等 owned resource ready，检查它自身消失，再跑下一消费者 |
| 通用函数接受 scenario 名并隐藏命令 | 读 test 看不到用户做了什么，失败也缺 argv | 完整 `pnpm exec niceeval …` 留在调用点；复用设施只做 spawn / parse / cleanup |
| 为了缩短正文提取 `runCarryScenario()`、`openAttempt()` | 产品动作与 expected 被藏到共享层，读者无法判断测试证明了什么 | Testkit 只接收跨两个 Repo 稳定的机械原语；领域动作、readiness 和 oracle 留在 owner |
| 用 `command | head` 后看 `$?` | 读到的是管道末端状态，producer 失败也可能显示 0 | 先保存 producer 的完整 exit/stdout/stderr，再裁剪展示 |
| 采集器已读取 stdout 后才给原始 stream 挂 readiness listener | 子进程启动得快时，listener 会漏掉已经输出的 URL 或 ready 行 | `waitForOutput(handle, …)` 先查自 spawn 起的缓冲，再等待新 chunk |
| Vitest 外包手写 `chromium.launch()` | 重做 browser fixture、超时、trace 和 cleanup | 浏览器场景直接使用 Playwright Test 的 `page` fixture |
| Journey 只检查最终页面 | 前面的 passing eval 可以没运行，最终仍像成功 | 在 list、dry、run、history、execution、href 每个接缝立即断言 |

## 后续如何维护

| 变化类型 | 先做什么 | 禁止的快捷处理 |
|---|---|---|
| 内部重构 | 保持 E2E expected 不变，修掉对 DTO、路径或 DOM 结构的耦合 | 顺手更新所有 snapshot |
| 公开结果有意变化 | 先更新契约，再修改唯一 owner 和必要 fixture | 在多层复制同一新 expected |
| 新 bug | 找现有 owner、补区分性断言、证明旧实现会红 | 只因现象相似就新增 `regression:` |
| Runner / Docker / CI 改动 | 修改外侧编排或资源收据，同一 Repo 测试正文继续运行 | 在 workflow 复制另一套产品断言 |
| 测试反复受兄弟影响 | 给 mutation 私有副本或结果根 | 增加顺序依赖和固定 sleep |
| 移动或退役测试 | 同批修索引、链接并删除本次产生的空目录 | 留下空分类让读者误以为仍有 owner |

评审者先从测试文件头复制单项重跑命令，再沿正文查第一处失败接缝。若必须跳到多个元数据文件才能知道 argv 或 expected，
该测试仍然不可维护，应把领域信息移回 owner 文件，而不是再补一份说明。

这些规则分别落在 [`architecture.md`](../architecture.md)、
[`testkit.md`](../testkit.md)、[`e2e/scenario-repos.md`](../e2e/scenario-repos.md)、
[`portfolio.md`](../portfolio.md) 与代码 example 中。
过程证据和具体错误草稿见
[`memory/readable-test-examples-false-green-review.md`](../../../../memory/readable-test-examples-false-green-review.md)。
