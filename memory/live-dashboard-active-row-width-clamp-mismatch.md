# live 面板 ACTIVE 行:宽终端下右侧被框截断,phase/detail 完全不可见

## 现象

宽终端(>100 列,如全屏 iTerm ~250 列)跑 `niceeval exp`,live 面板 ACTIVE 行只显示 eval id + 一大段空白 + `canar…`(who 列开头几个字符),elapsed 与 phase/detail(attempt 实际在干什么)整段消失在框外:

```
│ ● install/gpt-researcher                                                                  canar… │
```

正是注释里写的「phase/detail 才是 active 行存在的理由」那部分看不见了。2026-07-23 用户在 NiceEval-Eval 真机复现。

## 根因

行内容与外框各自按不同宽度计算,契约不匹配:

- `src/runner/feedback/human.ts` `buildFrameLines()`(约 L438)手写 `contentWidth = capability.width - 4`,其中 `capability.width` = 终端裸列数(如 246)——**没有过 `MAX_BOX_WIDTH` 钳制**。
- `formatActiveRow()` 按这个大宽度排版:detailReserve 封顶 80,identity 区(evalCol+whoCol)按剩余 65% 比例分到 ~150 列,who 列从约第 88 列才开始。
- `src/report/model/panel.ts` `renderPanel()` 把框钳到 `MAX_BOX_WIDTH = 100`,每行内容按 96 列截断补 `…`——who 列只剩开头几个字符,elapsed/detail 全部被切掉。

panel.ts 导出的 `panelContentWidth(width, mode)` 正是为调用方算「钳制后内容宽」而存在(注释:「同一个 width 参数——嵌套不吞可用宽度」),human.ts 没用它、自己减 4,漏掉钳制。终端 ≤100 列时两个算法一致,所以窄终端(含单测的 fake io)看不出问题——这也是它逃过测试的原因。

## 修法(已修)

设计裁决见 [live-dashboard-full-width-ruling](live-dashboard-full-width-ruling.md)(live 面板全宽 + 内容定宽列),实现 TODO 树在 `plan/live-dashboard-full-width-detail.md`。

- `src/report/model/panel.ts`:`PanelInput.capWidth`(默认 `true`)与 `panelContentWidth(width, mode, capWidth)` 新增豁免声明;省略时行为不变,`capWidth: false` 时框宽跟随传入宽度、不夹紧到 `MAX_BOX_WIDTH`。
- `src/runner/feedback/human.ts` `buildFrameLines()`:`contentWidth` 改用 `panelContentWidth(capability.width, capability.mode, false)`,末尾 `renderPanel(...)` 调用同样传 `capWidth: false`——两处用同一份豁免声明,不会再各按不同宽度排版/画框。plan/summary/saved 等永久面板的 `renderPanel` 调用未改,仍隐式 `capWidth: true`(封顶 100)。
- `formatActiveRow`/`formatExperimentHookRow` 的比例分配(55/45 + `detailReserve`)整体删除:renderer 闭包新增 `maxEvalIdWidth`/`maxWhoWidth` 状态,按本次运行实际出现过的最长值跨帧单调放宽,每帧按当前 `contentWidth` 的 40% / 20% 重新封顶(resize 因此重算封顶但不丢弃已观测到的最大值);`detail` 拿到 `sym + 身份两列 + elapsed + 分隔符` 之外的全部剩余宽度。`padTrunc` 从硬切改为超宽时尾部截断补 `…`。

回归测试:`src/runner/feedback/human.test.ts`「live dashboard — 宽终端下 ACTIVE 行与身份列分配」——`columns: 200` 的等价类断言行内容与外框同一宽度值、phase/detail 完整出现;另覆盖短 id 不垫空格、列宽跨帧单调、40%/20% 封顶截尾、永久面板仍封顶 100。`src/report/model/panel.test.ts` 补了 `capWidth: false` 的几何用例。
