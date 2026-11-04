import { useExperience } from "../experience/state.ts";
import { useEffect, useRef, useState } from "react";
import { useAssistant } from "./assistant.ts";

const EXAMPLES = [
  "Add a window to the right wall of the first floor",
  "Make the clothing store an anchor and move the food court next to it",
  "Set it up for a busy Poya day",
];

/** Talk to the design assistant. Its edits come back as a proposal to apply or discard. */
export function AssistantPanel() {
  const key = useAssistant((s) => s.key);
  return key ? <Chat /> : <KeyForm />;
}

function KeyForm() {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const ok = value.trim().startsWith("sk-ant-");
  return (
    <section className="panel">
      <header>
        <div>
          <h2>Design assistant</h2>
          <span className="muted">Describe a change; it proposes the edit</span>
        </div>
      </header>
      <div className="panel-body">
        <p>
          The assistant uses Claude and needs your Anthropic API key. Requests go straight from this browser to Anthropic, and you pay for what
          you use.
        </p>
        <label className="field stacked">
          <span>API key</span>
          <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this computer
        </label>
        <p className="muted">
          {remember
            ? "Stored in this browser only. Anyone using this computer could find it, so don't tick this on a shared machine."
            : "Kept until you close or reload the page."}
        </p>
        <button className="primary" disabled={!ok} onClick={() => useAssistant.getState().setKey(value.trim(), remember)}>
          Start
        </button>
        {value && !ok && <p className="warn">Anthropic API keys start with "sk-ant-".</p>}
      </div>
    </section>
  );
}

function Chat() {
  const { lines, busy, error, proposal, remember } = useAssistant();
  const { send, reset, forgetKey, apply, discard } = useAssistant.getState();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const prompt = useExperience(s=>s.prompt), promptKey = useExperience(s=>s.promptKey);
  useEffect(()=>{ if(prompt) setText(prompt); },[prompt,promptKey]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, busy]);

  const submit = () => {
    if (!text.trim() || busy) return;
    void send(text);
    setText("");
  };

  return (
    <section className="panel assistant">
      <header>
        <div>
          <h2>Assistant</h2>
          <span className="muted">Proposes changes for you to apply</span>
        </div>
        {lines.length > 0 && (
          <button onClick={reset} disabled={busy} title="Start a new conversation">
            New chat
          </button>
        )}
      </header>
      <div className="panel-body">
        <div className="chat">
          {!lines.length && (
            <div className="chat-empty">
              <p className="muted">Ask for a change to the plan or the people. For example:</p>
              {EXAMPLES.map((x) => (
                <button key={x} className="chip" onClick={() => setText(x)}>
                  {x}
                </button>
              ))}
            </div>
          )}
          {lines.map((l, i) => (
            <div key={i} className={`chat-line ${l.role}`}>
              {l.text}
            </div>
          ))}
          {busy && <div className="chat-line assistant muted">Working on it…</div>}
          <div ref={endRef} />
        </div>

        {proposal && !busy && (
          <div className="proposal-card">
            <strong>Waiting for you</strong>
            <ul>
              {proposal.changes.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
            <p className="muted">Highlighted on the plan. Ask for tweaks before applying, or apply and undo later.</p>
            <div className="proposal-actions">
              <button onClick={discard}>Discard</button>
              <button className="primary" onClick={apply}>
                Apply
              </button>
            </div>
          </div>
        )}

        {error && <p className="warn">{error}</p>}

        <div className="chat-input">
          <textarea
            rows={3}
            placeholder={proposal ? "Ask for a tweak, or apply it…" : "Describe a change…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="chat-input-row">
            <button className="link" onClick={forgetKey} title="Remove the API key from this browser">
              {remember ? "Forget saved key" : "Change key"}
            </button>
            <button className="primary" onClick={submit} disabled={busy || !text.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
