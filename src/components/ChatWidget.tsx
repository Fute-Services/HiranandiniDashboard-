"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import styles from "./ChatWidget.module.css";

/**
 * The dashboard's AI sales assistant: a navbar button (styled by the caller
 * via buttonClassName so it sits in the dock like any other entry) that
 * toggles a floating glass chat panel. Strictly project-scoped — the persona
 * and its refusal rules live server-side in src/lib/chat-prompt.ts, not
 * here, so they can't be bypassed by editing the client.
 */
export function ChatWidget({ buttonClassName }: { buttonClassName: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as replies stream in.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
      >
        &#10022;&nbsp; Ask AI
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="AI sales assistant">
          <div className={styles.head}>
            <div>
              <div className={styles.title}>Sales Assistant</div>
              <div className={styles.subtitle}>Hiranandani project queries only</div>
            </div>
            <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close chat">
              &times;
            </button>
          </div>

          <div className={styles.messages} ref={listRef}>
            {messages.length === 0 && (
              <p className={styles.hint}>
                Ask about our projects — amenities, locations, towers, or which
                one fits your customer.
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.bubble} ${m.role === "user" ? styles.user : styles.assistant}`}
              >
                {m.parts.map((part, i) =>
                  part.type === "text" ? <span key={i}>{part.text}</span> : null,
                )}
              </div>
            ))}
            {status === "submitted" && (
              <div className={`${styles.bubble} ${styles.assistant} ${styles.typing}`}>&hellip;</div>
            )}
            {status === "error" && (
              <p className={styles.error}>Something went wrong — please try again.</p>
            )}
          </div>

          <form className={styles.inputRow} onSubmit={submit}>
            <input
              className={styles.input}
              value={input}
              placeholder="Type your question…"
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" className={styles.send} disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
