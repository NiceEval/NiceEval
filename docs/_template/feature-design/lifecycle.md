# <功能或候选名> —— Lifecycle

本篇只描述从声明到运行与收尾的完整时序。
公开类型仍以 `library.md` 为单源,内部边界仍以 `architecture.md` 为单源。

## Owner

列出每个声明方拥有的输入、运行义务与不能越过的边界。
多个候选参与同一 Design 时,各篇使用相同 owner 名称,不能靠改名隐藏方案差异。

## 选择运行起点

画清 image、template、snapshot、Dockerfile、Compose、默认起点与替换表同时出现时的固定优先级。
说明一次运行选择一个完整起点、叠加多个起点,还是在某些组合下拒绝启动。

图和表直接使用正文里的完整名称。
不要另造单字母或带下标的公式式速记,再要求读者来回查图例。
分支拓扑确实比文字更清楚时,按 [`../../SVG-DESIGN.md`](../../SVG-DESIGN.md) 画 SVG;十行 Case 矩阵仍用表格,不把表格原样画成图。

## Build、Start、Install 与 Fixture

用一张顺序图明确区分:

1. 构建或定位可复用的 image / template / snapshot。
2. 创建实例并等待 ready。
3. 执行早期准备 Hook,再检查和安装运行条件。
4. 建立或恢复 baseline,在明确相位载入独立运行状态,准备 turn 前可见 Fixture。
5. 完成主体自己的 runtime setup 与最终验证屏障。
6. 执行主体;需要隐藏判分材料时只在最后一次主体 turn 结束后挂载,再评分并成对 cleanup。
7. 逐任务 teardown、状态回存、准备 Hook 与实例 stop。

候选没有某一相位时明确写「无」。
不能把现有早期 Hook 画到较晚位置,也不能只画一条无法由公开 API 调用的理想时序。

## Fresh 与 Reuse

给出每 Invocation、每 Sandbox 复用周期、每 Attempt 的次数表。
复用不能用一句"沿用 Sandbox"带过;必须写清 reset、重新检查、状态保留、回存和实例淘汰。
状态会演化时还要写明首载、fresh 后继、周期轮换、失败是否提交以及 save 缺席时怎样写入。
隐藏材料位于 workdir 外时也要画出 cleanup;cleanup 失败不得把材料带进下一条任务。

## Case 选择图

逐项代入所属 Design 的 `CASES.md`。
每个 Case 至少画出声明出处、被选中的起点、启动后安装项和不支持时的失败点。
每一行本身写清“有某起点时选谁,没有时选谁”,不能要求读者回跳前文才能解码。
