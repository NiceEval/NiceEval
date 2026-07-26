# 携带资格与指纹范围:2026-07-26 的三条设计裁决

一轮 cache.md 评审同时改了三处判据。记这条是因为其中两处的**第一版方案被推翻**,
而推翻的理由不写下来的话,下次很容易照着原路再走一遍。

## 裁决一:attempt deadline 不含排队,资格判据用 `executionMs`

- **裁决**:deadline 从 `sandbox.create` 起算;`result.json` 落 `executionMs`
  (`durationMs` 减去 `sandbox.queue` 段);携带资格判据是 `executionMs ≤ timeoutMs`。
- **曾选方案**:「声明 deadline 与 `durationMs` 同起点(`sandbox.queue`)、同不含收尾段」——
  当时的想法是「不改口径,只把现状钉死」。
- **否决理由**:把排队算进 deadline 会让**超时变成并发的函数**。一条 eval 排队 30 分钟、
  `timeoutMs` 40 分钟,开跑只剩 10 分钟预算;同一条命令在 `--max-concurrency 2` 和 `20`
  下产出不同的 `errored` 集合,还会加剧 `runner.md` 已经在担心的删失偏差。
  这不是「钉死现状」,是往更差的一边裁了一次。
- **为什么需要第三个字段**:资格判据是逐条判定的热路径,让它去 `phases` 里翻一个可能不存在的
  阶段,判据就不再是「读一个字段即可判定」的简单形态——与用例锁「读锁文件即可判定」同一条纪律。
- 日期:2026-07-26。落点:`docs/runner.md` 超时节、`docs/feature/record/architecture.md`
  的 `AttemptRecord`、`docs/feature/experiments/cache.md` 携带资格节。

## 裁决二:loader 读入的数据文件**进**指纹

- **裁决**:经 `loadYaml` / `loadJson` 读入的文件,内容哈希进读它的那条 eval。
- **曾选方案**:把数据文件划到指纹之外,理由是「算指纹时还没读,与 `ctx.fact()` 同理由」,
  规避手法是让用户把数据摘要手写进 `metadata`。
- **否决理由**:那个理由**在事实上不成立**。`dataset-fanout.md` 的写法是模块顶层
  `await loadYaml(...)`,它在**发现阶段的模块求值期**就执行了,而指纹在**解析期**算——
  晚一整个阶段。`ctx.fact()` 是 attempt 运行时才有的值,两者差着一个阶段,类比不成立。
  这个错误的理由句还挡住了更好的方案:loader 是 niceeval 自己的代码,读的时候顺手登记
  `(路径, 内容哈希)` 即可,用户什么都不用做。被否决的规避手法则要求用户手写哈希
  (niceeval 不导出哈希函数),忘了就静默失效。
- **真正留在线外的**:用户自己写 `fs.readFileSync` 读的文件——那才是 niceeval 看不见的。
- 日期:2026-07-26。落点:`docs/feature/experiments/cache.md` 的「eval 源码闭包」节。

## 裁决三:`--carry-ignoring-flag` 是一次重锚,不是一次豁免

- **裁决**:承认它的效果是永久的,措辞按重锚写;加两道启动期校验锁住用途
  (键必须**已经不在**本次 resolved `flags` 里,且必须**在候选历史条目的 `flags` 里出现过**);
  留痕落到条目的 `carriedIgnoringFlags`,不只落 Run diagnostic。
- **曾选写法**:正文写「只作用于这一次调用……不得长期悄悄生效」。
- **否决理由**:与同一篇的另一条不变量直接打架——携带条目合入时**按本 Run 口径重打指纹**,
  于是被放行的条目下一轮不带 flag 也照常命中。承诺一次性、实际永久。
  搬迁场景下永久正是想要的,所以改的是措辞和约束,不是行为。
- **连带发现**:出口要对历史侧重算 configHash,而指纹是哈希、不可逆,所以立了一条规则——
  **进 configHash 的字段必须落进 `run.json`**。`strict` 当时就违反了它(进哈希、没落盘)。
- 日期:2026-07-26。落点:`docs/feature/experiments/cache.md`、
  `docs/feature/record/library.md` 的 configHash 节。

## 复盘时要一起看的

同批还补了两个原本无处落地的契约:`--reuse-sandbox` 产出的排除靠 `sandbox.reused` 落盘字段
(此前 `serial-reuse.md` 写了「打上 `reuse` 标记」,但 `AttemptRecord` 里没有这个字段);
`judge` 的 `model` / `baseUrl` 进 configHash(此前两个哈希都没有它,换裁判模型不作废旧判定)。
两条都属于「文档声称有判据,但判据读的东西不存在」这一类,值得作为同类缺口的检查样例。
