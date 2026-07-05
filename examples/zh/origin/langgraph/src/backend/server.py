"""一个只用标准库 `http.server` 的服务器——和其它 origin/* 示例里"一个 node:http
服务器,无框架"是同一个思路,只是语言换成 Python:没有 FastAPI/Flask,HTTP 层自己写。

- `GET /healthz` -> `{"ok": true}`
- `GET /` -> `src/frontend/index.html`
- `POST /api/chat`,body `{message, sessionId?}` -> `text/event-stream`:
  每帧 `data: ` 后面是一个 JSON 事件,类型见下面 `_run_turn()` 的注释。
- `POST /api/chat/approve`,body `{toolCallId, approved}` -> `{"ok": true}`:
  HITL 审批端点,见下面 `_pending_approvals` 的注释。

会话 = LangGraph 的 thread_id:请求不带 sessionId(或传空字符串)时,服务器自己生成
一个新的 uuid 并用 `session` 帧发回给前端保存——不像有的实现把缺失的 sessionId
兜底成字面量 `"default"`,那样所有没显式带 id 的调用方会共享同一个 thread。
"""

from __future__ import annotations

import json
import os
import queue
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from agent import GATED_TOOLS, build_agent  # noqa: E402  (需要先 load_dotenv() 才能读到 .env 里的凭证)
from langgraph.types import Command  # noqa: E402

_PUBLIC_DIR = Path(__file__).resolve().parent.parent / "frontend"
_PORT = int(os.getenv("PORT", "35000"))

_agent = build_agent()

# HITL:toolCallId -> 一个等待审批结果的 Queue。ThreadingHTTPServer 给每个连接
# 一个线程,_run_turn 在自己的请求线程里同步阻塞 q.get()(不是 async/await,单纯
# 线程阻塞,SSE 连接全程不断);POST /api/chat/approve 在另一个线程里 q.put(...)
# 把它唤醒——和其它 origin/* 示例里 Promise resolver 的 Map 是同一个模式,只是
# Python 版用 queue.Queue 代替 resolve 回调。写入方只有 /api/chat/approve 一处,
# 读取/消费方只有 `_await_approval` 一处。
_pending_approvals: dict[str, "queue.Queue[bool]"] = {}
_pending_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:  # 安静一点,别刷 access log
        pass

    def do_GET(self) -> None:  # noqa: N802 (http.server 的方法名约定)
        if self.path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        if self.path == "/":
            html = (_PUBLIC_DIR / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        self._send_json(404, {"error": f"not found: GET {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/chat/approve":
            self._handle_approve()
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

    def _handle_approve(self) -> None:
        try:
            body = self._read_json()
            tool_call_id = body.get("toolCallId")
            approved = body.get("approved")
            if not isinstance(tool_call_id, str) or not isinstance(approved, bool):
                raise ValueError("body must be {toolCallId: string, approved: boolean}.")
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
            return
        with _pending_lock:
            pending = _pending_approvals.pop(tool_call_id, None)
        if pending is None:
            self._send_json(404, {"error": f"no pending approval for toolCallId {tool_call_id}"})
            return
        pending.put(approved)
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
                return False  # 浏览器已断开,后面的帧不用再发了

        if session_id is None:
            send({"type": "session", "sessionId": thread_id})
        try:
            for event in _run_turn(message, thread_id):
                if not send(event):
                    return
        except Exception as error:  # noqa: BLE001 -- demo 用:任何失败都要以 SSE 帧的形式让前端看到
            send({"type": "error", "message": str(error)})
        send({"type": "finish"})

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


def _run_turn(message: str, thread_id: str):
    """跑一轮对话(可能跨多次 interrupt/resume),把 LangGraph 的 stream 事件翻译成
    给前端的简单协议。事件类型:`text-delta` / `tool-input` / `tool-output` /
    `tool-approval-request` / `tool-output-denied`。
    """
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {"messages": [{"role": "user", "content": message}]}
    yield from _drive_graph(inputs, config)


def _drive_graph(graph_input, config: dict):
    """喂一次 `_agent.stream(graph_input, config, ...)`,直到这一轮自然结束或者
    命中 `interrupt()`——命中时同步阻塞等审批结果,再用 `Command(resume=...)`
    在同一个 thread_id 上递归续跑,直到图真正跑完。

    `stream_mode=["messages", "updates"]` 同时订阅两条流:"messages" 给 model
    节点里模型输出的逐 token delta(打字机效果);"updates" 给每个节点跑完之后的
    完整状态增量,用来拿到成对的、内容完整的工具调用({name, input, output})——
    不用去拼 "messages" 模式里逐块到达的 tool_call_chunks。节点名 "model"/"tools"
    是 `create_agent`(`langchain.agents`)编译出的图自己定的,不是我们起的名字——
    `_agent.get_graph().nodes` 能看到同样的名字。`HumanInTheLoopMiddleware` 命中
    时不产出 "model"/"tools" 键,而是产出一个 `"__interrupt__"` 键(见
    `langgraph.types.interrupt` 文档字符串里的例子),graph 在检查点处暂停,
    这次 `stream()` 调用直接结束——不是异常,是正常的生成器耗尽。
    """
    # 最近一次 "model" 节点更新里、属于 GATED_TOOLS 的 tool_call id,按原始顺序
    # 排列——HumanInTheLoopMiddleware.after_model 遇到 interrupt 时,会把同一批
    # tool_calls 里需要审批的那些按相同的相对顺序塞进 action_requests,靠这个顺序
    # 把 "审批请求" 和 "发起请求的 tool_call id" 配对回去(interrupt payload 本身
    # 不带 tool_call id)。
    pending_gated_ids: list[str] = []

    for stream_mode, payload in _agent.stream(graph_input, config, stream_mode=["messages", "updates"]):
        if stream_mode == "messages":
            chunk, metadata = payload
            if metadata.get("langgraph_node") == "model" and isinstance(chunk.content, str) and chunk.content:
                yield {"type": "text-delta", "delta": chunk.content}
            continue

        # stream_mode == "updates"
        if "__interrupt__" in payload:
            hitl_request = payload["__interrupt__"][0].value
            action_requests = hitl_request["action_requests"]
            gated_ids = pending_gated_ids[: len(action_requests)]

            for tool_call_id in gated_ids:
                yield {"type": "tool-approval-request", "toolCallId": tool_call_id}

            decisions = []
            for tool_call_id in gated_ids:
                approved = _await_approval(tool_call_id)
                if approved:
                    decisions.append({"type": "approve"})
                else:
                    decisions.append({"type": "reject", "message": "用户拒绝了这次调用"})
                    yield {"type": "tool-output-denied", "toolCallId": tool_call_id}

            # 递归续跑:resume 后 HumanInTheLoopMiddleware.after_model 节点重新
            # 执行(interrupt() 语义就是"从节点开头重放"),approve 的调用接着走
            # "tools" 节点、reject 的调用被换成合成的 ToolMessage,不会真的执行。
            yield from _drive_graph(Command(resume={"decisions": decisions}), config)
            return

        for node_name, update in payload.items():
            if node_name == "model":
                ai_message = update["messages"][-1]
                pending_gated_ids = [call["id"] for call in (ai_message.tool_calls or []) if call["name"] in GATED_TOOLS]
                for call in ai_message.tool_calls or []:
                    yield {
                        "type": "tool-input",
                        "toolCallId": call["id"],
                        "name": call["name"],
                        "input": call["args"],
                    }
            elif node_name == "tools":
                for tool_message in update["messages"]:
                    yield {
                        "type": "tool-output",
                        "toolCallId": tool_message.tool_call_id,
                        "output": _parse_tool_content(tool_message.content),
                    }


def _await_approval(tool_call_id: str) -> bool:
    """阻塞当前请求线程,直到 `POST /api/chat/approve` 对这个 toolCallId 调用一次。"""
    pending: "queue.Queue[bool]" = queue.Queue(maxsize=1)
    with _pending_lock:
        _pending_approvals[tool_call_id] = pending
    return pending.get()


def _parse_tool_content(content: object) -> object:
    if not isinstance(content, str):
        return content
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return content


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", _PORT), Handler)
    print(f"langgraph example listening on http://127.0.0.1:{_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
