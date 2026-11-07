# 裁决:不提供官方 fixture 装载 API(cloneRepo 等)

> 2026-08-01 被 [[prepare-commands-adopted]] 部分替代:采纳内置 prepare 命令 `checkout()` / `installTool()`。新事实是复用缓存与稳定 identity(当时未评估);旧判据「不为自设地雷配绕行 API」本身仍然成立并保留在 api-design.md——当年的地雷(沙箱内框架文件)已拆,这次的动机不是绕地雷。`t.sandbox.cloneRepo` 一类 test 期装载 API 仍然不做。

- **裁决**(2026-07-29,用户定案):fixture 怎么进 workdir(git clone、拷贝、生成)留给用户 shell,
  niceeval 不提供 `cloneRepo` 一类官方装载 API。
- **曾选方案**:公开 `t.sandbox.cloneRepo({ source, ref, ... })`(内部 Skill 安装已有同类实现)。
- **否决理由**:三判据全落用户侧——事实在用户域(clone 哪个 repo、要不要历史/凭据/子目录)、
  失败大声报错且下一步明确、形态发散(API 承诺一种变体就要背全部)。它当初显得必要,只因框架把
  `__niceeval__` 埋进 workdir,把一行 shell 变成需要内部知识的样板;正解是拆地雷(见
  [sandbox-injection-deleted-o11y-host-side](sandbox-injection-deleted-o11y-host-side.md)),
  不是给地雷配官方绕行 API。判据成文在 `docs/api-design.md`「哪些能力进公开 API」。
