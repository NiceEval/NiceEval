import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isFileUIPart, isToolUIPart, type FileUIPart, type UIMessage } from "ai";
import "./App.css";

type ModelDef = { id: string; label: string; contextTokens: number };

function App() {
  const [models, setModels] = useState<ModelDef[]>([]);
  const [model, setModel] = useState("deepseek-v4-flash");
  const [modelOpen, setModelOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref so the transport closure always reads the latest model value.
  const modelRef = useRef(model);
  modelRef.current = model;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, model: modelRef.current },
        }),
      }),
    [],
  );

  const { messages, status, sendMessage, stop } = useChat({ transport });

  const running = status === "submitted" || status === "streaming";
  const currentLabel = models.find((m) => m.id === model)?.label ?? model;

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then(({ models: ms }: { models: ModelDef[] }) => {
        setModels(ms);
        if (ms[0]) setModel(ms[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (running) return;

    // Convert to FileUIPart (data URL) so the SDK tracks them in UIMessage.
    const fileParts = await Promise.all(attachments.map(toFileUIPart));

    setInput("");
    setAttachments([]);
    previews.forEach((p) => URL.revokeObjectURL(p));
    setPreviews([]);

    sendMessage({ text: text || "请描述这张图片。", files: fileParts });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setAttachments((prev) => [...prev, ...files]);
    setPreviews((prev) => [...prev, ...newPreviews]);
    e.target.value = "";
  }

  function removeAttachment(i: number) {
    URL.revokeObjectURL(previews[i]);
    setAttachments((prev) => prev.filter((_, j) => j !== i));
    setPreviews((prev) => prev.filter((_, j) => j !== i));
  }

  // Close model dropdown on outside click.
  useEffect(() => {
    if (!modelOpen) return;
    const handler = () => setModelOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [modelOpen]);

  return (
    <main className="layout">
      <header className="header">
        <h1 className="title">AI Assistant</h1>

        <div className="model-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`model-btn${modelOpen ? " open" : ""}`}
            onClick={() => setModelOpen((v) => !v)}
          >
            <span>{currentLabel}</span>
            <span className="arrow">▾</span>
          </button>

          {modelOpen && (
            <div className="model-dropdown">
              {models.map((m) => (
                <div
                  key={m.id}
                  className={`model-opt${m.id === model ? " active" : ""}`}
                  onClick={() => { setModel(m.id); setModelOpen(false); }}
                >
                  <div className="model-name">{m.label}</div>
                  {m.contextTokens >= 1000 && (
                    <div className="model-meta">{Math.round(m.contextTokens / 1000)}K ctx</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </header>

      <section className="messages">
        {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {running && (messages.at(-1)?.role !== "assistant") && (
          <div className="msg assistant typing">思考中…</div>
        )}
        <div ref={messagesEndRef} />
      </section>

      {previews.length > 0 && (
        <div className="image-previews">
          {previews.map((src, i) => (
            <div key={i} className="preview-wrap">
              <img src={src} alt="" />
              <button className="preview-remove" onClick={() => removeAttachment(i)}>×</button>
            </div>
          ))}
        </div>
      )}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); void handleSend(); }}>
        <button
          type="button"
          className="upload-btn"
          title="上传图片"
          onClick={() => fileInputRef.current?.click()}
        >
          🖼
        </button>
        <input
          type="text"
          className="text-input"
          placeholder="发送消息…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {running ? (
          <button type="button" className="send-btn stop-btn" onClick={stop}>停止</button>
        ) : (
          <button
            type="submit"
            className="send-btn"
            disabled={!input.trim() && attachments.length === 0}
          >
            发送
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </form>
    </main>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`msg-group ${isUser ? "user-group" : "assistant-group"}`}>
      {message.parts.map((part, i) => {
        if (isFileUIPart(part) && part.mediaType.startsWith("image/")) {
          return (
            <div key={i} className={`msg ${isUser ? "user" : "assistant"} msg-image-wrap`}>
              <img src={part.url} alt={part.filename ?? "image"} className="msg-image" />
            </div>
          );
        }
        if (part.type === "text" && part.text) {
          return (
            <div key={i} className={`msg ${isUser ? "user" : "assistant"}`}>
              <span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>
            </div>
          );
        }
        if (isToolUIPart(part)) {
          const state = part.state;
          const name = getToolName(part);
          if (state === "input-streaming" || state === "input-available") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name}({state === "input-streaming" ? "…" : JSON.stringify(part.input)})
              </div>
            );
          }
          if (state === "output-available") {
            return (
              <div key={part.toolCallId} className="tool-bubble">
                ⚙ {name} → {JSON.stringify((part as { output?: unknown }).output)}
              </div>
            );
          }
        }
        return null;
      })}
    </div>
  );
}

async function toFileUIPart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ type: "file", mediaType: file.type, filename: file.name, url: reader.result as string });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
