"""真实 LangGraph 图:手写 StateGraph(不用 langchain.agents.create_agent),这样才能显式
控制三个 niceeval 需要证明的协议行为:

- 普通工具节点:get_weather 经标准 ToolNode 执行。
- HITL interrupt 节点:calculate 命中后先 interrupt(),恢复靠 Command(resume=...)。
- Subgraph:delegate_research 不走 ToolNode,路由到一个编译好的子图节点 "research"——
  LangGraph 用 `stream(..., subgraphs=True)` 真的会给子图内部节点一个非空 checkpoint
  namespace(形如 "research:<uuid>"),这是 fromLangGraphEvents() 的 namespace 契约
  (docs/feature/adapters/sdk/langgraph/README.md)在真实协议里的落点,不是模拟结构。

model -> tools/research/approval -> model 是同一个循环:模型看到工具结果后可以继续回答,
直到不再产出 tool_calls 才到 END。
"""

from __future__ import annotations

import json
import os
from typing import Literal

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode
from langgraph.types import interrupt

# 只有 calculate 挂 HITL 审批,delegate_research 路由进子图,其余(get_weather)走标准 ToolNode。
GATED_TOOL = "calculate"
SUBGRAPH_TOOL = "delegate_research"

# ---------------------------------------------------------------------------
# 工具:两个真走 ToolNode 的固定数据工具 + 一个只用于给模型看 schema 的子图入口工具
# (delegate_research 的函数体永远不会被直接调用,执行由 "research" 子图节点接管)。
# ---------------------------------------------------------------------------

_KNOWN_CITIES: dict[str, tuple[str, int]] = {
    "北京": ("晴", 26),
    "上海": ("多云", 29),
    "广州": ("雷阵雨", 32),
    "深圳": ("阴", 31),
    "杭州": ("小雨", 28),
}
_CONDITIONS = ["晴", "多云", "阴", "小雨", "雷阵雨"]


@tool
def get_weather(city: str) -> dict:
    """查询某个城市当前的天气(演示用固定数据,不接外部 API)。需要实时天气时调用。"""
    key = city.strip()
    if key in _KNOWN_CITIES:
        condition, temp_c = _KNOWN_CITIES[key]
    else:
        seed = sum(ord(ch) for ch in key)
        condition, temp_c = _CONDITIONS[seed % len(_CONDITIONS)], 15 + seed % 18
    return {
        "city": key,
        "condition": condition,
        "tempC": temp_c,
        "summary": f"{key}当前{condition},气温 {temp_c}°C。",
    }


def _safe_calculate(expression: str) -> float:
    """只支持数字、+ - * / ( ) 的递归下降解析器——不用 eval(),非法字符直接抛错。"""
    allowed = set("0123456789.+-*/() ")
    if not expression or any(ch not in allowed for ch in expression):
        raise ValueError(f'表达式只能包含数字和 + - * / ( ):收到 "{expression}"')

    pos = 0

    def peek() -> str | None:
        return expression[pos] if pos < len(expression) else None

    def skip_spaces() -> None:
        nonlocal pos
        while peek() == " ":
            pos += 1

    def parse_number() -> float:
        nonlocal pos
        skip_spaces()
        start = pos
        while peek() is not None and (peek().isdigit() or peek() == "."):
            pos += 1
        if pos == start:
            raise ValueError(f'表达式在位置 {pos} 处缺少数字:"{expression}"')
        return float(expression[start:pos])

    def parse_factor() -> float:
        nonlocal pos
        skip_spaces()
        if peek() == "(":
            pos += 1
            value = parse_expr()
            skip_spaces()
            if peek() != ")":
                raise ValueError(f'表达式缺少右括号:"{expression}"')
            pos += 1
            return value
        if peek() == "-":
            pos += 1
            return -parse_factor()
        return parse_number()

    def parse_term() -> float:
        nonlocal pos
        value = parse_factor()
        while True:
            skip_spaces()
            op = peek()
            if op not in ("*", "/"):
                return value
            pos += 1
            rhs = parse_factor()
            value = value * rhs if op == "*" else value / rhs

    def parse_expr() -> float:
        nonlocal pos
        value = parse_term()
        while True:
            skip_spaces()
            op = peek()
            if op not in ("+", "-"):
                return value
            pos += 1
            rhs = parse_term()
            value = value + rhs if op == "+" else value - rhs

    result = parse_expr()
    skip_spaces()
    if pos != len(expression):
        raise ValueError(f'表达式在位置 {pos} 处有多余字符:"{expression}"')
    return result


@tool
def calculate(expression: str) -> dict:
    """计算一个只含数字和 + - * / 的算术表达式,需要人工审批后才会真正执行。"""
    return {"expression": expression, "result": _safe_calculate(expression)}


@tool
def delegate_research(topic: str) -> str:
    """把一个需要检索资料的研究性问题委派给专门的 research 子agent。委派后不要自己回答,
    等子agent 的结果回来再总结。"""
    raise RuntimeError("delegate_research 不应被直接调用——执行应由 research 子图节点接管")


# ---------------------------------------------------------------------------
# research 子图:单节点,内部真的执行一次确定性的 search_web 工具调用(经真实
# ToolNode),再把结果打包成满足外层 delegate_research tool_call 的 ToolMessage。
# 子图独立编译、作为节点加进父图——这是 LangGraph 官方的 subgraph-as-node 写法,
# 流式输出时子图内部节点自然带上非空 checkpoint namespace。
# ---------------------------------------------------------------------------

_RESEARCH_FACTS: dict[str, str] = {
    "langgraph": "LangGraph 是 LangChain 团队维护的状态图编排框架,核心概念是节点、边和 checkpoint。",
}


@tool
def search_web(query: str) -> dict:
    """在研究子agent 内部使用的检索工具(演示用固定数据,不接外部搜索引擎)。"""
    key = query.strip().lower()
    fact = _RESEARCH_FACTS.get(key, f"关于「{query}」暂无收录资料,给出通用性回答。")
    return {"query": query, "fact": fact}


def _research_answer(state: MessagesState) -> dict:
    last_ai = next(m for m in reversed(state["messages"]) if isinstance(m, AIMessage))
    call = next(c for c in (last_ai.tool_calls or []) if c["name"] == SUBGRAPH_TOOL)
    topic = call["args"].get("topic", "")
    result = search_web.invoke({"query": topic})
    return {"messages": [ToolMessage(tool_call_id=call["id"], content=result["fact"])]}


_research_builder = StateGraph(MessagesState)
_research_builder.add_node("search", _research_answer)
_research_builder.add_edge(START, "search")
_research_builder.add_edge("search", END)
research_subgraph = _research_builder.compile()


# ---------------------------------------------------------------------------
# HITL 审批节点:interrupt() 暂停整张图;恢复值是一个 {"decision": "<optionId>"} 字典
# (由 server.py 的 Command(resume=...) 携带,decision 就是前端选的 optionId 原文)。
# ---------------------------------------------------------------------------

def _approval(state: MessagesState) -> dict:
    """decision 只回两种取值:approve 分支真的执行 calculate,reject 分支合成一条
    "拒绝" ToolMessage、不执行。这个节点自己不判断"这次算的是 tools/finished 还是
    tools/error"——那是 server.py 的事(它调 Command(resume=...) 时已经知道 decision,
    见 _drive_graph 里 "approval" 分支的注释),这里只管图状态本身正确演进。
    """
    last_ai = next(m for m in reversed(state["messages"]) if isinstance(m, AIMessage))
    call = next(c for c in (last_ai.tool_calls or []) if c["name"] == GATED_TOOL)
    decision = interrupt(
        {
            "action_request": {"action": call["name"], "args": call["args"]},
            "description": f"需要人工批准执行 {call['name']}({call['args']})",
            "config": {"allow_accept": True, "allow_ignore": True},
        }
    )
    if decision.get("decision") == "accept":
        result = calculate.invoke(call["args"])
        return {"messages": [ToolMessage(tool_call_id=call["id"], content=json.dumps(result))]}
    return {"messages": [ToolMessage(tool_call_id=call["id"], content="用户拒绝了这次调用")]}


# ---------------------------------------------------------------------------
# 主图:model -> route -> {tools | research | approval} -> model -> ... -> END
# ---------------------------------------------------------------------------

def _model_node(llm):
    def call_model(state: MessagesState) -> dict:
        ai = llm.invoke(state["messages"])
        return {"messages": [ai]}

    return call_model


def _route(state: MessagesState) -> Literal["tools", "research", "approval", "__end__"]:
    last = state["messages"][-1]
    if not isinstance(last, AIMessage) or not last.tool_calls:
        return END
    names = {c["name"] for c in last.tool_calls}
    if GATED_TOOL in names:
        return "approval"
    if SUBGRAPH_TOOL in names:
        return "research"
    return "tools"


def build_agent():
    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        api_key=os.getenv("OPENAI_API_KEY"),
    ).bind_tools([get_weather, calculate, delegate_research])

    builder = StateGraph(MessagesState)
    builder.add_node("model", _model_node(llm))
    builder.add_node("tools", ToolNode([get_weather]))
    builder.add_node("research", research_subgraph)
    builder.add_node("approval", _approval)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", _route, ["tools", "research", "approval", END])
    builder.add_edge("tools", "model")
    builder.add_edge("research", "model")
    builder.add_edge("approval", "model")

    return builder.compile(checkpointer=InMemorySaver())
