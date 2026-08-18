import { defineEval } from "niceeval";
import { includes, excludes, pattern } from "niceeval/expect";

// 这条 eval 专门验证会话续接的两半承诺:同一 thread 里第二轮记得住第一轮说的事
// (codex.resumeThread 续接成功);t.newSession() 造出的新 thread 不共享历史。
//
// 故意用一句"记住我最喜欢的颜色"而不是"你创建的文件叫什么"——workspace/ 目录是所有
// thread 共享的同一份磁盘状态,如果拿文件是否存在当隔离信号,新 thread 完全可能自己
// ls 一下发现文件还在,那测的是"文件系统有没有清空"而不是"对话记忆有没有隔离",
// 两回事。纯口头事实不受工作目录状态干扰,是更干净的隔离信号。
export default defineEval({
  description: "测试跨轮记忆与 newSession() 隔离",

  async test(t) {
    await t.send("我最喜欢的颜色是蓝色,记住这个偏好。这轮不用跑命令也不用建文件。");
    const recall = await t.send("我刚才说我最喜欢的颜色是什么?");
    t.check(recall.message, pattern(/蓝/));
    t.check(t.reply, includes("蓝"));

    const fresh = t.newSession();
    await fresh.send("我最喜欢的颜色是什么?");
    t.check(fresh.reply, excludes("蓝"));
  },
});
