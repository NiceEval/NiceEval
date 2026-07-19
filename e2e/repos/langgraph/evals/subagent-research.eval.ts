import { defineEval } from "niceeval";

// subagent 层级协议行为:delegate_research 路由进一个真实编译好的 LangGraph 子图节点
// "research"(不走标准 ToolNode,见 src/backend/agent.py 头注释)。LangGraph 用
// `stream(..., subgraphs=True)` 给子图内部节点一个非空 checkpoint namespace,
// fromLangGraphEvents() 把它归一成 subagent.called/subagent.completed——这是真实协议
// 产生的层级,不是模拟结构。
export default defineEval({
  description: "subagent 层级:delegate_research 路由进 research 子图,namespace 归一为 subagent 事件",

  async test(t) {
    const turn = await t.send("帮我研究一下 langgraph 是什么,这个问题请委派给 research 子agent 处理。");
    turn.expectOk();

    await t.group("research 子图被委派且正常完成", () => {
      t.calledSubagent("research", { status: "completed" });
      t.calledTool("delegate_research", { status: "completed" });
    });

    t.messageIncludes(/LangGraph/i);
  },
});
