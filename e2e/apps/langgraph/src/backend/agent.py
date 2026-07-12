"""LangChain 1.x 的推荐写法:`create_agent`(来自 `langchain.agents`,内部就是一个
编译好的 LangGraph 图——`langgraph.prebuilt.create_react_agent` 已经在 LangGraph 自己
的源码里标了 deprecated,官方文档现在把 `create_agent` 当成建 agent 的标准入口)。

`agent = create_agent(...)` 返回的就是一个 `CompiledStateGraph`(`agent.get_graph()`
能看到 `model` -> `tools` -> `model` 的循环、`agent.stream()` 的用法和手写
`StateGraph` 完全一样),`src/server.py` 直接拿它当图用,不关心它是怎么搭出来的。

HITL:`langchain.agents.middleware.HumanInTheLoopMiddleware` 是官方对 LangGraph
原生 `interrupt()` 的封装——`interrupt_on={"calculate": True}` 让它在 `model` 节点
之后插一个 `HumanInTheLoopMiddleware.after_model` 图节点,那个节点对命中的工具调用
调 `langgraph.types.interrupt(...)`,整张图在检查点处暂停;`src/server.py` 用
`Command(resume={"decisions": [...]})` 在同一个 `thread_id` 上恢复。这是 LangGraph
四家框架里"停轮-恢复"最原生的一种(参见 `docs/feature/adapters/reference/agent-loop-apis.md`
「LangGraph」一节),对比手写 `beforeToolCall`/`canUseTool` 回调(`pi-sdk`、
`claude-agent-sdk` 两个示例的做法),这里不需要自己维护一个进程内的
resolver Map——真正需要维护状态的是"暂停期间还开着的 SSE 连接怎么等审批结果"这件事,
graph 本身的暂停/恢复完全由 checkpointer 管。

可观测性:Python 版 langsmith SDK 是真·零代码——设好 LANGSMITH_TRACING /
LANGSMITH_OTEL_ENABLED / LANGSMITH_OTEL_ONLY / OTEL_EXPORTER_OTLP_ENDPOINT 四个
环境变量(见 .env.example),`langchain_core` 默认的 tracing callback 第一次调模型时
就会按这些变量自动接好 OTel exporter,不需要显式初始化代码。
"""

from __future__ import annotations

import os

from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware, ToolRetryMiddleware
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver

SYSTEM_PROMPT = """你是一个乐于助人的中文 AI 助手。
需要天气信息时调用 get_weather,并用工具返回的数据作答,不要凭空编造天气。
需要精确计算时调用 calculate,把表达式交给它算,不要心算。
普通闲聊不要调用任何工具。回复保持中文、友好、简洁。"""

# HITL 演示:只有 calculate 需要人工审批,与其它 origin/* 示例保持一致(只挂一个
# gated 工具)。src/server.py 靠这个集合把"model 节点刚产出的哪个 tool_call"
# 和"随后 interrupt() 弹出的 action_request"配对,两处必须一致。
GATED_TOOLS = frozenset({"calculate"})

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


# ---------------------------------------------------------------------------
# agent 本体。不配 checkpointer 就没有跨 invoke 的记忆,所以这里显式配一个
# InMemorySaver——同一个 thread_id 在进程存活期间有多轮记忆,重启即丢,演示用足够;
# 生产场景换 PostgresSaver 之类的持久实现。
# ---------------------------------------------------------------------------


def build_agent():
    llm = ChatOpenAI(
        model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
        base_url=os.getenv("OPENAI_BASE_URL") or None,
        api_key=os.getenv("OPENAI_API_KEY"),
    )
    return create_agent(
        model=llm,
        tools=[get_weather, calculate],
        system_prompt=SYSTEM_PROMPT,
        checkpointer=InMemorySaver(),
        # allowed_decisions 只留 approve/reject——这个 demo 的前端只有"允许/拒绝"
        # 两个按钮,不演示 edit(改参数重跑)、respond(代答跳过执行)这两种 LangChain
        # 也支持的决策类型。
        middleware=[
            HumanInTheLoopMiddleware(
                interrupt_on={name: {"allowed_decisions": ["approve", "reject"]} for name in GATED_TOOLS}
            ),
            # create_agent 默认不接工具异常:工具一抛错整张图跟着炸,前端只能收到一条笼统的
            # error 帧。挂上重试 middleware 并把 max_retries 设成 0,拿到的其实是它的
            # on_failure="continue" 兜底——异常落成 status="error" 的 ToolMessage,模型
            # 看到错误还能继续作答,src/server.py 也才有"这次调用失败了"可转发。
            ToolRetryMiddleware(max_retries=0, on_failure="continue"),
        ],
    )
