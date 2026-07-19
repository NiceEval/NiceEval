"""自建 HTTP 服务器(标准库 http.server,无框架),把真实 LangGraph `graph.stream(...,
stream_mode=["updates"], subgraphs=True)` 的输出原样翻译成 niceeval `fromLangGraphEvents()`
认识的协议帧(`{seq, channel, event, namespace, data}`,见
docs/feature/adapters/sdk/langgraph/README.md 与 src/agents/langgraph.ts 的类型声明),经
SSE 推给 niceeval 的 adapter(../../agents/langgraph.ts)。LangGraph 本身不提供这个协议的
线上 transport——"自建 HTTP 服务" 正是契约允许的两种部署形态之一,这里只做协议帧的忠实
转写,不模拟或改写图的真实执行结果。

- `GET /healthz` -> `{"ok": true}`
- `POST /api/chat` body `{message, sessionId?}` -> `text/event-stream`:每帧 `data: ` 后面
  是一个 JSON 帧;非协议帧只有一种 `{"type": "session", "sessionId": ...}`(会话 id 回传,
  首轮才发)。
- `POST /api/chat/resume` body `{requestId, decision}` -> `{"ok": true}`:HITL 恢复端点,
  `decision` 是 adapter 侧选中的 optionId 原文("accept" / "ignore")。

HITL 恢复靠同一条 SSE 连接不关、请求线程同步阻塞在 Queue 上(见 `_pending`/`_await_decision`)
——命中 interrupt 时不关闭连接,`/api/chat/resume` 在另一个线程 put 解除阻塞,原连接接着
从同一个 `graph.stream(Command(resume=...), ...)` 继续产出协议帧,`seq` 跨这次暂停连续
不归零。
"""

from __future__ import annotations

import itertools
import json
import os
import queue
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator

from dotenv import load_dotenv

load_dotenv()

from agent import build_agent  # noqa: E402  (需要先 load_dotenv() 才能读到 .env 里的凭证)
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage  # noqa: E402
from langgraph.types import Command  # noqa: E402

_PORT = int(os.getenv("PORT", "35100"))
_agent = build_agent()

# interrupt id -> 等待恢复决策的 Queue。ThreadingHTTPServer 给每个连接一个线程,
# _stream_chat 在自己的请求线程里同步阻塞 q.get();POST /api/chat/resume 在另一个
# 线程里 q.put(...) 把它唤醒。与 examples/zh/tier1/langgraph 的 _pending_approvals
# 是同一个模式,只是 key 换成 LangGraph 自己发的 interrupt id。
_pending: dict[str, "queue.Queue[str]"] = {}
_pending_lock = threading.Lock()

# 子图容器节点名单:这些节点在父命名空间(ns == ())上报的 "更新" 是子图的完整最终状态
# (共享 messages 通道的全量回放),不是这一步的增量——只有其中满足外层 tool_call 的最后
# 一条消息是新信息,其余在子图内部 namespace 的更新里已经报过一次(见 _translate 里的
# 特判)。这个名单由本仓库的图结构决定,不是协议通用规则。
_SUBGRAPH_CONTAINER_NODES = frozenset({"research"})


def _parse_tool_content(content: Any) -> Any:
    if not isinstance(content, str):
        return content
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return content


def _translate(ns: tuple[str, ...], chunk: dict[str, Any], seq: Iterator[int], last_decision: str | None) -> tuple[list[dict], str | None]:
    """一个 `(namespace, updates-chunk)` -> 若干协议帧,以及"这一步是否命中了 interrupt"
    (命中时返回该 interrupt 的 id,驱动循环据此转入等待恢复)。"""
    frames: list[dict] = []
    ns_list = list(ns)

    if "__interrupt__" in chunk:
        intr = chunk["__interrupt__"][0]
        frames.append(
            {
                "seq": next(seq),
                "channel": "lifecycle",
                "event": "interrupted",
                "namespace": ns_list,
                "data": {"interrupts": [{"id": intr.id, "value": intr.value}]},
            }
        )
        return frames, intr.id

    for node_name, update in chunk.items():
        if not isinstance(update, dict):
            continue
        messages = update.get("messages")
        if not messages:
            continue

        if node_name in _SUBGRAPH_CONTAINER_NODES and len(ns) == 0:
            # 子图作为节点时父级(根命名空间)上报的是子图全量状态回放——里面唯一的新信息
            # (满足外层 tool_call 的 ToolMessage)已经在子图内部 namespace 的增量更新里
            # 处理过一次(同一个 callId,action.result 不分命名空间,子图内那次已经把它
            # 解析出来,顺带触发了 ensureNamespace → subagent.called)。这里整条跳过,
            # 否则会对同一个 tool_call_id 重发一次 tools/finished(转换器会按 callId 去重,
            # 不算错,但没有意义)。
            continue

        for msg in messages:
            if isinstance(msg, AIMessage):
                content = msg.content if isinstance(msg.content, str) else str(msg.content or "")
                message_data: dict[str, Any] = {"role": "assistant", "content": content}
                if msg.usage_metadata:
                    message_data["usage_metadata"] = dict(msg.usage_metadata)
                frames.append(
                    {
                        "seq": next(seq),
                        "channel": "messages",
                        "event": "finish",
                        "namespace": ns_list,
                        "data": {"message": message_data},
                    }
                )
                for call in msg.tool_calls or []:
                    frames.append(
                        {
                            "seq": next(seq),
                            "channel": "tools",
                            "event": "started",
                            "namespace": ns_list,
                            "data": {"id": call["id"], "name": call["name"], "input": call["args"]},
                        }
                    )
            elif isinstance(msg, ToolMessage):
                is_rejected = node_name == "approval" and last_decision is not None and last_decision != "accept"
                if is_rejected:
                    frames.append(
                        {
                            "seq": next(seq),
                            "channel": "tools",
                            "event": "error",
                            "namespace": ns_list,
                            "data": {"id": msg.tool_call_id, "error": _parse_tool_content(msg.content)},
                        }
                    )
                else:
                    frames.append(
                        {
                            "seq": next(seq),
                            "channel": "tools",
                            "event": "finished",
                            "namespace": ns_list,
                            "data": {"id": msg.tool_call_id, "output": _parse_tool_content(msg.content)},
                        }
                    )
    return frames, None


def _register_pending(interrupt_id: str) -> "queue.Queue[str]":
    """在 interrupted 帧发给客户端**之前**调用——否则有真实竞态:客户端收到帧后可以立刻
    发 /api/chat/resume,如果那时 `_pending` 还没登记这个 id,`_handle_resume` 会 404
    "no pending interrupt"(命中过一次,窗口很窄但并发下真的会撞上:python 线程被 GIL
    调度让给同一进程里跑另一个 eval 的请求,客户端的 resume 反而先到)。登记必须先于
    发送,不能倒过来靠"网络总比同进程代码慢"这种时序假设。
    """
    pending: "queue.Queue[str]" = queue.Queue(maxsize=1)
    with _pending_lock:
        _pending[interrupt_id] = pending
    return pending


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:  # 安静一点,别刷 access log
        pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": f"not found: GET {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/chat/resume":
            self._handle_resume()
            return
        if self.path != "/api/chat":
            self._send_json(404, {"error": f"not found: POST {self.path}"})
            return
        try:
            body = self._read_json()
            message = body.get("message")
            if not isinstance(message, str) or not message.strip():
                raise ValueError("body.message must be a non-empty string.")
            session_id = body.get("sessionId") or None
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return
        self._stream_chat(message, session_id)

    def _handle_resume(self) -> None:
        try:
            body = self._read_json()
            request_id = body.get("requestId")
            decision = body.get("decision")
            if not isinstance(request_id, str) or not isinstance(decision, str):
                raise ValueError("body must be {requestId: string, decision: string}.")
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return
        with _pending_lock:
            pending = _pending.pop(request_id, None)
        if pending is None:
            self._send_json(404, {"error": f"no pending interrupt for requestId {request_id}"})
            return
        pending.put(decision)
        self._send_json(200, {"ok": True})

    # -- SSE --------------------------------------------------------------

    def _stream_chat(self, message: str, session_id: str | None) -> None:
        thread_id = session_id or uuid.uuid4().hex
        self.send_response(200)
        self.send_header("content-type", "text/event-stream; charset=utf-8")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        self.close_connection = True

        def send(event: dict) -> bool:
            try:
                self.wfile.write(f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError):
                return False

        if session_id is None:
            send({"type": "session", "sessionId": thread_id})

        seq = itertools.count(1)
        config = {"configurable": {"thread_id": thread_id}}
        current_input: Any = {"messages": [HumanMessage(content=message)]}
        last_decision: str | None = None

        try:
            while True:
                interrupt_id: str | None = None
                pending: "queue.Queue[str] | None" = None
                for ns, _mode, chunk in _agent.stream(current_input, config, stream_mode=["updates"], subgraphs=True):
                    frames, hit = _translate(ns, chunk, seq, last_decision)
                    if hit:
                        # 先登记等待队列,再把 interrupted 帧发出去——见 _register_pending 的
                        # 竞态说明,登记必须先于发送。
                        interrupt_id = hit
                        pending = _register_pending(interrupt_id)
                    for frame in frames:
                        if not send(frame):
                            return
                    if hit:
                        break
                if interrupt_id is None or pending is None:
                    send({"seq": next(seq), "channel": "lifecycle", "event": "completed", "namespace": [], "data": {}})
                    break
                last_decision = pending.get()
                current_input = Command(resume={"decision": last_decision})
        except Exception as error:  # noqa: BLE001 — 任何失败都要让 adapter 看到 lifecycle failed
            send(
                {
                    "seq": next(seq),
                    "channel": "lifecycle",
                    "event": "failed",
                    "namespace": [],
                    "data": {"error": str(error)},
                }
            )

    # -- 工具方法 -----------------------------------------------------------

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length", 0))
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw) if raw else {}


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", _PORT), Handler)
    print(f"langgraph e2e backend listening on http://127.0.0.1:{_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
