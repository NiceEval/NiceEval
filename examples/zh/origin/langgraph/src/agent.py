"""正经的 LangGraph 用法:手搭一个两节点的 `StateGraph`(agent -> tools -> agent 的
ReAct 循环),不走 `langchain.agents.create_agent` 这类高层封装——这样 `langgraph`
才是这个项目里真正被 import、被调用的库,而不是隐藏在 LangChain 的 agent 工厂背后。

节点、条件边、`ToolNode`、`tools_condition`、checkpointer 全部来自 `langgraph`
本身(`langgraph.graph` / `langgraph.prebuilt` / `langgraph.checkpoint.memory`)。
`InMemorySaver` 让同一个 thread_id 内的多轮对话有记忆——进程重启就丢,演示用足够。

可观测性:Python 版 langsmith SDK 是零代码——设好 LANGSMITH_TRACING /
LANGSMITH_OTEL_ENABLED / LANGSMITH_OTEL_ONLY / OTEL_EXPORTER_OTLP_ENDPOINT 四个
环境变量(见 .env.example),`langchain_core` 的默认 tracing callback 第一次真的
调模型时就会按这些变量自动接好 OTel exporter,不需要显式初始化代码。
"""

from __future__ import annotations

import os

from langchain_core.messages import SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, MessagesState, START
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode, tools_condition

SYSTEM_PROMPT = """你是一个乐于助人的中文 AI 助手。
需要天气信息时调用 get_weather,并用工具返回的数据作答,不要凭空编造天气。
需要精确计算时调用 calculate,把表达式交给它算,不要心算。
普通闲聊不要调用任何工具。回复保持中文、友好、简洁。"""

# ---------------------------------------------------------------------------
# 两个工具:get_weather(city) 和 calculate(expression)。
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
        # 未知城市按名字算确定性伪随机——同一个城市名永远得到同一个答案,方便复现。
        seed = sum(ord(ch) for ch in key)
        condition, temp_c = _CONDITIONS[seed % len(_CONDITIONS)], 15 + seed % 18
    return {
        "city": key,
        "condition": condition,
        "tempC": temp_c,
        "summary": f"{key}当前{condition},气温 {temp_c}°C。",
    }


def _calculate(expression: str) -> float:
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
    """计算一个只含数字和 + - * / ( ) 的算术表达式。需要精确计算时调用,不要心算。"""
    return {"expression": expression, "result": _calculate(expression)}


_TOOLS = [get_weather, calculate]

# ---------------------------------------------------------------------------
# 图本体:START -> agent -> (有 tool_calls ? tools : END),tools -> agent 循环。
# ---------------------------------------------------------------------------


def build_agent() -> CompiledStateGraph:
    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        api_key=os.getenv("OPENAI_API_KEY"),
    )
    llm_with_tools = llm.bind_tools(_TOOLS)

    def call_model(state: MessagesState) -> dict:
        messages = state["messages"]
        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(SYSTEM_PROMPT), *messages]
        response = llm_with_tools.invoke(messages)
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("agent", call_model)
    graph.add_node("tools", ToolNode(_TOOLS))
    graph.add_edge(START, "agent")
    # tools_condition 读最后一条 AIMessage:有 tool_calls 就路由到 "tools" 节点,
    # 否则路由到 "__end__"(langgraph 内部识别这个字面量,不用手动映射到 END)。
    graph.add_conditional_edges("agent", tools_condition)
    graph.add_edge("tools", "agent")

    # 不配持久化 checkpointer——InMemorySaver 让同一个 thread_id 在进程存活期间
    # 有多轮记忆,重启即丢,演示用足够;生产场景换 PostgresSaver 之类的持久实现。
    return graph.compile(checkpointer=InMemorySaver())
