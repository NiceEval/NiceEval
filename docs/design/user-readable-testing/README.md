# 测试作者面与 E2E 组织方式

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [EVIDENCE](EVIDENCE.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md) · [TESTKIT](TESTKIT.md)

niceeval 已经有 unit 与 E2E，却没有同时解决四个问题：

1. 测试正文能否直接读出用户动作与结果；
2. 历史 bug 补测后能否说明自己杀死哪种旧错误；
3. CLI、Report、Package 与 Adapter 是否在正确边界验收；
4. 本地与 GitHub Actions 是否执行同一套真实场景 Repo。

现有测试常能证明一个内部规则，但读者很难判断它是否经过真实包、真实进程或真实协议。
相反，旧 E2E 又把准备、执行和断言串成大脚本，前面失败会遮住后面，单项也难复现。

## 四个候选

| 候选 | 作者主要看到什么 | 元平台成本 | 测试可读性 | 本地 / CI |
|---|---|---:|---:|---:|
| [PLAN-1](PLAN-1/README.md) | Behavior 元数据与媒介 matcher | 中 | 中 | 沿用现有 runner |
| [PLAN-2](PLAN-2/README.md) | Behavior、typed view、World 与 Registry | 高 | 中低 | 需要新 world runtime |
| [PLAN-3](PLAN-3/README.md) | 声明式 Acceptance Case 与 Projection | 很高 | 规格高、调试低 | 需要新 driver runtime |
| [PLAN-4](PLAN-4/README.md)（推荐） | 真实场景 Repo 里的单边界 E2E 与 Journey E2E | 低 | 高 | 同一根命令 + host / Docker executor |

前三个候选尝试用越来越强的声明模型连接测试身份、观察面和证据。
PLAN-4 把机器协议缩到 repo 编排，测试语义保留在原生代码中。

## 固定比较场景

[CASES](CASES.md) 使用同一组问题比较候选，包括：

- 修改一条 Eval 后的精确重跑；
- Report 多媒介与目标下钻；
- 可控调度；
- 一次证据多项验收；
- 真实 adapter 协议；
- 候选 tarball 在外部 cwd 消费；
- 历史 bug 的回归归属；
- 本地、Docker 与 GitHub Actions 同构运行。

## 同一条历史 bug 的差异

目标是防住 `show --json` 经 pipe 截断。

PLAN-2 需要先找 Behavior、Recipe、World、Observed parser 与 execution registration，正文最后才比较结果。
PLAN-4 直接保留真实命令和独立 sentinel：

```ts
// regression: d8d5a84b
test("show --json 经 pipe 仍交付完整 JSON", async () => {
  const result = await runProcess([
    "pnpm", "--silent", "exec", "niceeval", "show", locator, "--json",
  ]);

  expect(result.exitCode, result.diagnostic()).toBe(0);
  expect(result.stdout.length).toBeGreaterThan(128 * 1024);

  const json = parseJson(result.stdout, result.diagnostic());
  expect(json.view).toBe("attempt");
  expect(JSON.stringify(json.data)).toContain("tail-sentinel");
});
```

这里的 helper 只启动进程和解析 JSON。
阈值、sentinel 与成功条件都在测试文件里，候选实现无法替测试生成答案。
跨 Repo 共享这些机械能力时，交付物与待测包的信任边界见 [TESTKIT](TESTKIT.md)。

## 阅读顺序

- 先看共同目标与硬边界：[GOALS](GOALS.md)、[LIMITS](LIMITS.md)。
- 用固定真实场景核对候选：[CASES](CASES.md)、[EVIDENCE](EVIDENCE.md)。
- 看各候选完整形态：[PLAN-1](PLAN-1/README.md)、[PLAN-2](PLAN-2/README.md)、[PLAN-3](PLAN-3/README.md)、[PLAN-4](PLAN-4/README.md)。
- 最终选择与迁移边界见 [DECISION](DECISION.md)。
- 共享测试设施的包边界、稳定外层与公开门槛见 [TESTKIT](TESTKIT.md)。
