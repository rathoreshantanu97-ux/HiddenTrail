import React, { useState } from "react";
import { useChat } from "../lib/useChat.js";

// ---------------------------------------------------------------------------
// CHAT PANEL — "All Players" tab is always available. "Detectives" tab is
// only rendered at all when canUseDetectiveChannel is true (i.e. this
// client is not Mr. X) -- Mr. X's UI never even shows the tab exists,
// on top of the server refusing to serve those messages if somehow asked.
// ---------------------------------------------------------------------------
export default function ChatPanel({ roomId, myPlayerId, myRole, myDisplayName }) {
  const { allMessages, detectiveMessages, canUseDetectiveChannel, sendToAll, sendToDetectives } = useChat({
    roomId,
    myPlayerId,
    myRole,
  });
  const [activeTab, setActiveTab] = useState("all");
  const [draft, setDraft] = useState("");

  const messages = activeTab === "detectives" ? detectiveMessages : allMessages;
  const sendFn = activeTab === "detectives" ? sendToDetectives : sendToAll;

  function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    sendFn(body).catch((e) => console.error("Failed to send message:", e));
  }

  return (
    <div style={styles.panel}>
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(activeTab === "all" ? styles.tabActive : {}) }}
          onClick={() => setActiveTab("all")}
        >
          All Players
        </button>
        {canUseDetectiveChannel && (
          <button
            style={{ ...styles.tab, ...(activeTab === "detectives" ? styles.tabActive : {}) }}
            onClick={() => setActiveTab("detectives")}
          >
            Detectives Only
          </button>
        )}
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && <div style={styles.emptyNote}>No messages yet.</div>}
        {messages.map((m) => (
          <div key={m.id} style={styles.messageRow}>
            <span style={{ ...styles.sender, color: m.senderRole === "mrx" ? "#c0392b" : "#333" }}>
              {m.senderName}:
            </span>{" "}
            <span style={styles.body}>{m.body}</span>
          </div>
        ))}
      </div>

      <div style={styles.inputRow}>
        <input
          style={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder={activeTab === "detectives" ? "Message detectives only..." : "Message everyone..."}
          maxLength={500}
        />
        <button style={styles.sendBtn} onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    overflow: "hidden",
    height: 210,
  },
  tabs: { display: "flex", borderBottom: "1px solid #eee" },
  tab: {
    flex: 1,
    padding: "8px 10px",
    fontSize: 12.5,
    fontWeight: 600,
    background: "#fafafa",
    border: "none",
    cursor: "pointer",
    color: "#888",
  },
  tabActive: { background: "#fff", color: "#111", borderBottom: "2px solid #111" },
  messages: { flex: 1, overflowY: "auto", padding: "8px 10px", fontSize: 13 },
  emptyNote: { color: "#aaa", fontSize: 12, textAlign: "center", marginTop: 20 },
  messageRow: { padding: "3px 0", lineHeight: 1.4 },
  sender: { fontWeight: 700 },
  body: { color: "#333" },
  inputRow: { display: "flex", borderTop: "1px solid #eee" },
  input: {
    flex: 1,
    border: "none",
    padding: "8px 10px",
    fontSize: 13,
    outline: "none",
  },
  sendBtn: {
    border: "none",
    background: "#111",
    color: "#fff",
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};
