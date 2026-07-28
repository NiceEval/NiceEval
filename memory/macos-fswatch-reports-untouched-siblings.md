# macOS 的 fs.watch 会为没被碰过的兄弟文件报事件（真 bug，已修）

## 现象

`niceeval view` 的项目侧 watch（`ProjectFileWatcher`）本来只该在闭集里的模块文件（报告、
主题、`niceeval.config.ts` 及它们的 import 图）变更时通知重建。实测在 macOS 上，往
`.niceeval/**` 落一份 `result.json`，同一个项目根下**完全没被写过**的 `report.mjs` 也会收到
一次 `rename` 事件，于是记录落盘被判成模块变更。

最小复现（Node 26 / darwin 25）：

```js
watch(root, (ev, name) => console.log(ev, name));
writeFileSync(join(root, ".niceeval/exp/run/result.json"), "{}");
// → change "<root 自己的 basename>"
// → rename ".niceeval"
// → rename "report.mjs"      ← 这一行是假的，report.mjs 没动过
```

三种 `filename` 形态都会出现：被监听目录**自己**的 basename、发生嵌套变更的顶层条目名、
以及同目录里无关文件的名字（还可能是 `null`）。

## 根因

`fs.watch` 在 macOS 上走 FSEvents，事件按目录粒度合并后回填文件名，回填出来的名字不保证
就是真正变更的那个文件。`ProjectFileWatcher.handle` 原来只做
`this.files.has(resolve(dir, filename))` 判定，把事件名当成了事实。

后果不是多一次重建那么轻：`view` 的重建按理由分流——记录变更沿用上一次装载出的报告 / 主题
定义，模块文件变更才重新走 namespaced import 装载整棵图（见
`docs/feature/reports/view.md`「变更分两类，失效到不同深度」）。事件名被信任时，默认的
`.niceeval` 布局（记录根在项目根之下）里**每一次记录落盘都被判成模块变更**，分流等于没有，
一边跑一边看的场景每写一个 attempt 就重新求值一遍整个 niceeval 库。

## 修法

`src/view/server.ts` 的 `ProjectFileWatcher`：事件只当作「去核对一下」的信号，变没变由闭集
文件的 `mtimeMs + size` 快照说了算。`sync()` 采一次基线（首次采样不算变更），`handle()` 触发
一次异步核对（进行中的核对把同批事件合成一次），只有快照真的不同才 `onChange()`。

守护落在 `src/view/server-rebuild.test.ts` 的「失效分流」一格：fixture 的记录根是项目根下的
`.niceeval`，报告文件在项目根——正好是会踩到这个平台行为的布局。断言的是报告模块的装载次数
（报告在模块顶层往日志文件追加一行，namespaced import 下进程内计数器共享不到，文件是唯一
通道）。只按事件名判定的写法在这一格会数到 1 而不是 0。

## 适用场景

任何「按目录挂 `fs.watch` + 按 filename 过滤到具体文件」的代码在 macOS 上都不可靠。要么按
内容 / mtime 核对，要么接受粗粒度触发。跨平台的判定差异也别只在 Linux 上验——Linux 的
inotify 报的名字是准的，同一段代码在那边不会露馅。
