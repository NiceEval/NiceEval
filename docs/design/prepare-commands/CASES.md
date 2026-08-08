**相关文档**:[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [DECISION](DECISION.md)

---

# 内置 prepare 命令 Cases

固定所有候选共同面对的输入与验收结果;每个 PLAN 只说明自己怎样守护,不改写 Case 降低要求。

## C1:复用下的重仓库 checkout

**输入:**Eval 每题需要同一仓库的固定 commit 出现在 workdir;Experiment 开启 `sandboxReuse`,一个复用周期承接几十条 Attempt。

**验收:**第二条 Attempt 起不再访问网络,workdir 仍每题回到干净的题目起点。
checkout 的 identity 由 repo 与 ref 构成并进入 fingerprint;换 ref 使旧命中失效。

## C2:workdir 外的工具 ensure

**输入:**Experiment 需要一个安装很慢的二进制,装在 `$HOME`;可能已被 template 预装。

**验收:**预装或首次安装后,后续 Attempt 的成本只剩一次探测。
探测必须读实际状态;声明版本变化时命中失效并重新安装、复检。

## C3:计划面的复用成本

**输入:**作者在开启复用前想知道哪些准备每题重付、哪些一次就够。

**验收:**`--dry` 逐命令给出成本类别与依据,不需要真实创建 Sandbox。
类别判断错误时归责清晰:探测型内置命令 的类别来自自己的声明,普通 command 一律标注为每题重新执行。

## C4:fixture 物料照旧

**输入:**题目起始文件与判分材料经现有 `registerSandboxContent()` / `putContent()` 与 `test(t)` 上传进入 Sandbox。

**验收:**候选不为它们新增声明面;digest 身份与 send 区间归因不变,重新执行成本保持在本地拷贝量级。
