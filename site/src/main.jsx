import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Clipboard,
  FileCode2,
  Folder,
  GitFork,
  Play,
  Terminal,
  Wrench,
} from "lucide-react";
import "./styles.css";

const githubUrl = "https://github.com/ctrdh/fastevals";

const modes = {
  humans: {
    label: "For humans",
    command: "npx fastevals init",
    caption: "Write evals. Run a matrix. Open the evidence.",
    files: ["evals/weather.eval.ts", "fastevals.config.ts", ".fastevals/latest"],
  },
  agents: {
    label: "For agents",
    command: "npx fastevals --agent codex fixtures/button",
    caption: "Give an agent a task. Verify the workspace.",
    files: ["PROMPT.md", "EVAL.ts", "__fastevals__/results.json"],
  },
};

function App() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Strip />
        <Setup />
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar shell">
      <a className="brand" href="#top" aria-label="fastevals home">
        <span className="mark" />
        <span>fastevals</span>
      </a>
      <nav className="nav" aria-label="Primary">
        <a href="#setup">Start</a>
        <a href={githubUrl}>GitHub</a>
      </nav>
    </header>
  );
}

function Hero() {
  const [mode, setMode] = useState("humans");
  const [copied, setCopied] = useState(false);
  const active = modes[mode];
  const copyCommand = async () => {
    await navigator.clipboard?.writeText(active.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <section id="top" className="hero shell">
      <div className="hero-copy">
        <div className="logo-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>The eval framework for agents and software.</h1>
        <div className="mode-switch" aria-label="Audience">
          {Object.entries(modes).map(([key, item]) => (
            <button
              key={key}
              type="button"
              className={key === mode ? "active" : ""}
              onClick={() => setMode(key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="copy-row">
          <code>$ {active.command}</code>
          <button type="button" aria-label="Copy command" onClick={copyCommand}>
            <Clipboard size={16} />
          </button>
          <span className={copied ? "copy-status visible" : "copy-status"}>copied</span>
        </div>
        <p className="lede">{active.caption}</p>
        <div className="actions">
          <a className="button primary" href="#setup">
            <Play size={15} />
            Start
          </a>
          <a className="button ghost" href={githubUrl}>
            <GitFork size={15} />
            GitHub
          </a>
        </div>
      </div>

      <ProductVisual mode={active} />
    </section>
  );
}

function ProductVisual({ mode }) {
  return (
    <div className="visual" aria-label="fastevals product diagram">
      <div className="wire a" />
      <div className="wire b" />
      <div className="wire c" />
      <div className="file-card">
        <div className="card-head">
          <Folder size={18} />
          <span>evals/</span>
        </div>
        <ul>
          {mode.files.map((file, index) => (
            <li key={file}>
              {index === 0 ? <FileCode2 size={16} /> : index === 1 ? <Wrench size={16} /> : <Terminal size={16} />}
              <span>{file}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="run-card">
        <code>$ fastevals</code>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>weather</span>
          <b>passed</b>
        </div>
        <div className="run-line">
          <CheckCircle2 size={16} />
          <span>fixtures/button</span>
          <b>91.7%</b>
        </div>
      </div>
      <div className="score-card">
        <span>Pass rate</span>
        <strong>91.7%</strong>
        <div className="score-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

function Strip() {
  return (
    <section className="strip shell" aria-label="fastevals workflow">
      <Step k="1" title="Define" text="One file per behavior." />
      <Step k="2" title="Run" text="Agents, services, functions." />
      <Step k="3" title="Inspect" text="Trace, cost, verdict." />
    </section>
  );
}

function Step({ k, title, text }) {
  return (
    <article>
      <span>{k}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  );
}

function Setup() {
  return (
    <section id="setup" className="setup shell">
      <div>
        <p className="eyebrow">Start</p>
        <h2>Install. Init. Evaluate.</h2>
      </div>
      <pre>{`npm install -D fastevals
npx fastevals init
npx fastevals`}</pre>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
