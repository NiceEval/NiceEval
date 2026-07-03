"""一个只用标准库 `http.server` 的服务器——和其它 origin/* 示例里"一个 node:http
服务器,无框架"是同一个思路,只是语言换成 Python:没有 FastAPI/Flask,HTTP 层自己写。

- `GET /healthz` -> `{"ok": true}`
- `GET /` -> `public/index.html`
- `POST /api/chat`,body `{message, sessionId?}` -> `text/event-stream`:
  每帧 `data: ` 后面是一个 JSON 事件,类型见下面 `_run_turn()` 的注释。

会话 = LangGraph 的 thread_id:请求不带 sessionId(或传空字符串)时,服务器自己生成
一个新的 uuid 并用 `session` 帧发回给前端保存——不像有的实现把缺失的 sessionId
兜底成字面量 `"default"`,那样所有没显式带 id 的调用方会共享同一个 thread。
"""

from __future__ import annotations

import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from agent import build_agent  # noqa: E402  (需要先 load_dotenv() 才能读到 .env 里的凭证)

_PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
_PORT = int(os.getenv("PORT", "5488"))

_agent = build_agent()


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
    """跑一轮对话,把 LangGraph 的 stream 事件翻译成给前端的简单协议。

    `stream_mode=["messages", "updates"]` 同时订阅两条流:"messages" 给 agent
    节点里模型输出的逐 token delta(打字机效果);"updates" 给每个节点跑完之后的
    完整状态增量,用来拿到成对的、内容完整的工具调用({name, input, output})——
    不用去拼 "messages" 模式里逐块到达的 tool_call_chunks。
    """
    config = {"configurable": {"thread_id": thread_id}}
    inputs = {"messages": [{"role": "user", "content": message}]}

    for stream_mode, payload in _agent.stream(inputs, config, stream_mode=["messages", "updates"]):
        if stream_mode == "messages":
            chunk, metadata = payload
            if metadata.get("langgraph_node") == "agent" and isinstance(chunk.content, str) and chunk.content:
                yield {"type": "text-delta", "delta": chunk.content}
        elif stream_mode == "updates":
            for node_name, update in payload.items():
                if node_name == "agent":
                    ai_message = update["messages"][-1]
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
