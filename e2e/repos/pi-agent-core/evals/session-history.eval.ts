// 协议行为:pi-agent-core 没有服务端落盘 resume——应用把历史存在内存里,adapter 用
// ctx.session.history() 读取并整体提交(见 src/server.ts 的 sessions Map + agents/pi-agent-core.ts
// 的 session.capture)。第二轮要能引用第一轮问过的事实,证明历史真的原样喂回给了模型。
import { defineEval } from "niceeval";

export default defineEval({
  description: "客户端历史经 ctx.session.history() 整体提交,第二轮能引用首轮事实",
  async test(t) {
    const first = await t.send("深圳今天天气怎么样?记住这个城市,我后面会再问你。");
    first.succeeded();
    first.calledTool("get_weather", { input: { city: /深圳/ } });

    const second = await t.send("我们上一轮问的是哪个城市?只回答城市名,不用调用工具。");
    second.succeeded();
    second.messageIncludes(/深圳/);
  },
});
