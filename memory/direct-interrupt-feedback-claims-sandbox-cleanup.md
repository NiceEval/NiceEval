---
format: niceeval.memory/v1
id: direct-interrupt-feedback-claims-sandbox-cleanup
title: 无 Sandbox 的中断反馈虚构容器清理
createdAt: 2026-09-20
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - nered_7T9RM0RTNQYF0XJ6
      - netake_HGME4FFZF8G3ZFES
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/cli/test/interrupt-feedback.test.ts#necase_D31DET9WE90ZY004"]}
promotions: []
---
# 现象与根因

无 Sandbox 的 Direct Eval 在公开 CLI 中收到 SIGINT 后，退出码 130 和 INTERRUPTED 终态正确，但 Human 无条件输出 sandbox containers cleaned up。提示来自 Human renderer 和无 coordinator 的 fallback 字面量，不代表实际创建或清理过容器。

# 修复边界

只将提示改为 interrupted: printing partial results completed so far.，不改变中断、cleanup、调度、queued/running 状态或动态面板。

# TDD

首次 red：`pnpm e2e test --repo cli --artifact-root .artifacts/interrupt-feedback-red -- --run test/interrupt-feedback.test.ts`。安装候选后以 Direct Eval 就绪 marker 决定 SIGINT 时点。退出码 130 和 INTERRUPTED 断言首次通过，中性提示断言因多出的 sandbox containers cleaned up 失败。

长期 owner 为 `e2e/cli/test/interrupt-feedback.test.ts#necase_D31DET9WE90ZY004`。它使用真实公开 CLI 与 Testkit process cleanup；正式 red 与完整可靠性接管由受管回归关系保存。用户观察到的瞬态 live 面板不作为已复现 bug，不在本条目中声称修复。
