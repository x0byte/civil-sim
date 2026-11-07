import { useImprovements } from "../improvements/store.ts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useExperience } from "../experience/state.ts";
import { Mark } from "../ui/Brand.tsx";
import { useAssistant } from "./assistant.ts";
import { Thinking } from "./AssistantWindow.tsx";

/** Talk to the Assistant. Its edits come back as a proposal to apply or discard. */
export function AssistantPanel({ suggestions }: { suggestions?: ReactNode }) {
  const key = useAssistant((s) => s.key);
  return key ? <Chat suggestions={suggestions} /> : <KeyForm suggestions={suggestions} />;
}

function KeyForm({ suggestions }: { suggestions?: ReactNode }) {
  const prompt = useExperience((s) => s.prompt);
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const ok = value.trim().startsWith("sk-ant-");
  return (
    <div className="assistant-welcome">
      <div className="assistant-hello">
        <Mark size={28} />
        <h2>Describe a change to the assistant</h2>
        <p className="muted">
          Ask in plain words: "add a window on the west wall", "set it up for a busy Poya day". You see every change before it's made.
        </p>
      </div>
      {suggestions}
      {prompt && <p className="prepared-prompt">Your next question: {prompt}</p>}
      <label className="field stacked">
        <span>Anthropic API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember on this computer
      </label>
      <p className="muted small">
        {remember
          ? "Stored in this browser only. Anyone using this computer could find it, so don't tick this on a shared machine."
          : "Kept until you close or reload the page."}{" "}
        Requests go straight from this browser to Anthropic, and you pay for what you use.
      </p>
      <button className="primary wide" disabled={!ok} onClick={() => useAssistant.getState().setKey(value.trim(), remember)}>
        Start
      </button>
      {value && !ok && <p className="warn">Anthropic API keys start with "sk-ant-".</p>}
    </div>
  );
}

function Chat({ suggestions }: { suggestions?: ReactNode }) {
  const { lines, busy, error, proposal, remember } = useAssistant();
  const { send, forgetKey, apply, discard } = useAssistant.getState();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prompt = useExperience((s) => s.prompt);
  const promptKey = useExperience((s) => s.promptKey);
  useEffect(() => {
    if (!prompt) return;
    setText(prompt);
    inputRef.current?.focus();
  }, [prompt, promptKey]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length, busy, proposal]);

  const submit = () => {
    if (!text.trim() || busy) return;
    void send(text);
    setText("");
  };

  return (
    <div className="assistant-chat">
      <div className="chat">
        {!lines.length && (
          <div className="chat-empty">
            <div className="assistant-hello">
              <Mark size={28} />
              <h2>What would you like to change?</h2>
              <p className="muted">Ask about the building or the people. Changes show on the plan first, for you to apply or discard.</p>
            </div>
            {suggestions}
          </div>
        )}
        {lines.map((l, i) =>
          l.role === "assistant" ? (
            <div key={i} className="chat-line assistant">
              <Mark size={14} className="chat-avatar" />
              <div className="bubble">{l.text}</div>
            </div>
          ) : (
            <div key={i} className={`chat-line ${l.role}`}>
              <div className="bubble">{l.text}</div>
            </div>
          ),
        )}
        {busy && (
          <>
            <Thinking />
            <button
              onClick={() => {
                useAssistant.getState().cancel();
                useImprovements.getState().cancel();
              }}
            >
              Cancel
            </button>
          </>
        )}

        {proposal && !busy && (
          <div className="proposal-card">
            <div className="proposal-title">
              <strong>Ready for you to check</strong>
              <span className="muted">
                {proposal.changes.length} change{proposal.changes.length === 1 ? "" : "s"}, highlighted on the plan
              </span>
            </div>
            <ul>
              {proposal.changes.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
            <div className="proposal-actions">
              <button onClick={discard}>Discard</button>
              <button className="primary" onClick={apply}>
                Apply
              </button>
            </div>
          </div>
        )}
        {error && (
          <div role="status">
            <p className="warn">{error}</p>
            <button
              disabled={busy}
              onClick={() => {
                const last = [...lines].reverse().find((line) => line.role === "user");
                if (last) void send(last.text);
              }}
            >
              Retry
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={2}
          placeholder={proposal ? "Ask for a tweak, or apply it…" : "Ask the assistant to change something…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="send" onClick={submit} disabled={busy || !text.trim()} title="Send (Enter)">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
      <div className="chat-foot">
        <span className="muted">Enter to send · Shift+Enter for a new line</span>
        <button className="link" onClick={forgetKey} title="Remove the API key from this browser">
          {remember ? "Forget saved key" : "Change key"}
        </button>
      </div>
    </div>
  );
}
