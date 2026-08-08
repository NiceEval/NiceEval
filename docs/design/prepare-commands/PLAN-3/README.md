# PLAN-3:零新 API,惯用法进文档(不推荐)

**相关文档**:[决策主题](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [CASES](../CASES.md)

## 方案定位

不加任何公开面。
检查与缓存的惯用法(`command -v x || install`、workdir 外镜像目录、`defineSandboxCommand` 封装)写进 feature 用例手册,由作者照抄。

## 守护

| Case | 路径 |
|---|---|
| C1 | 用例手册给出「镜像目录 + 每题写入」的 shell 惯用法 |
| C2 | 用例手册给出探测式安装的 `defineSandboxCommand` 样板 |
| C3 | 不守护:普通 command 无法向 `--dry` 声明成本类别,计划面只能一律标每题重新执行 |
| C4 | 天然满足 |

## 优点

- 零公开面、零维护义务;所有能力今天就成立。
- 不触碰 memory 旧裁决。

## 缺点

- C3 不满足:复用省不省、省多少,只有跑起来才知道。
- identity 与检查样板在每个项目重复一遍,写错(探测漏了 PATH、缓存放进 workdir)只有运行症状,没有框架反馈。
- 惯用法不可移植:每个仓库长出自己的 checkout 封装,官方无法在 docs-site 给出一条稳定教学路径。
