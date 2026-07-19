// 本仓库唯一的 agent 变体,供 experiments/ci.ts 下全部 4 条 Eval 共用同一个 experiment。
// skills / pythonPlugins / postSetup 都挂在这一份配置上——拆成多个 agent 变体会让每条 Eval
// 各自触发一次完整 bub 安装(安装 checkpoint key 含 pythonPlugins 集合的 hash,见
// src/agents/bub.ts),额外能力对不测它的 Eval 不可见,不需要为此拆分配置
// (docs/engineering/e2e-ci/adapters/README.md「仓库 Eval 预算」)。
import { bubAgent } from "niceeval/adapter";
import type { SandboxHook } from "niceeval/sandbox";

/** postSetup 顺序证据落盘的位置——workdir 之外的绝对路径,不进 agent diff。 */
export const POSTSETUP_ORDER_LOG = "/tmp/niceeval-bub-postsetup-order.log";

// 两个钩子按数组顺序各写一行:evals/extensions 读回这个文件,断言 "first" 先于 "second"
// 出现,证明 postSetup 数组确实按声明顺序执行,不是并发或反序跑的。
const markFirst: SandboxHook = async (sandbox) => {
  await sandbox.runShell(`printf 'first\\n' >> ${POSTSETUP_ORDER_LOG}`);
};

const markSecond: SandboxHook = async (sandbox) => {
  await sandbox.runShell(`printf 'second\\n' >> ${POSTSETUP_ORDER_LOG}`);
};

export default bubAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  pythonPlugins: [{ package: "cowsay" }],
  postSetup: [markFirst, markSecond],
});
