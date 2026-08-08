import React, { useState, useEffect, useRef } from "react";
import { useChat } from "../lib/useChat.js";

// ---------------------------------------------------------------------------
// CHAT PANEL — "All Players" tab is always available. "Detectives" tab is
// only rendered at all when canUseDetectiveChannel is true (i.e. this
// client is not Mr. X) -- Mr. X's UI never even shows the tab exists,
// on top of the server refusing to serve those messages if somehow asked.
//
// UNREAD INDICATOR: a small dot on a tab means "there's at least one
// message on that channel you haven't actually SEEN yet" -- and "seen"
// means genuinely scrolled to the bottom of that tab's message list, not
// just "this tab happened to be open when the message arrived." A
// message landing while you're scrolled up reading earlier messages
// stays unread (dot visible) until you actually scroll down far enough
// to reveal it, even on the currently-active tab -- confirmed this
// matters: an earlier version marked messages "seen" the instant they
// arrived on the active tab regardless of scroll position, which doesn't
// match what "read" should mean.
//
// Mechanism: each tab's message-list div is watched for scroll position;
// "seenCounts[tab]" only advances to the live message count when that
// tab's scroll is within NEAR_BOTTOM_PX of true bottom AT THE TIME a new
// message arrives (checked via a scroll listener AND re-checked whenever
// the message count changes, since a message arriving can itself push
// the true bottom further away even if the user hadn't moved their
// scrollbar at all).
// ---------------------------------------------------------------------------
const NEAR_BOTTOM_PX = 24;
// Simple fixed height, per explicit instruction -- with the sidebar
// restructure (round/turn/timer moved to the map-top bar, the redundant
// standalone ticket-chip panel dropped, explore-mode regrouped with the
// other controls), there's real freed-up vertical space now, so a fixed
// 270px doesn't need the self-adjusting/shrink-to-fit logic an earlier
// version of this file had -- that complexity is no longer the right
// tradeoff once the sidebar itself is shorter.
const CHAT_HEIGHT = 270;

export default function ChatPanel({ roomId, myPlayerId, myRole, myDisplayName }) {
  const { allMessages, detectiveMessages, canUseDetectiveChannel, sendToAll, sendToDetectives } = useChat({
    roomId,
    myPlayerId,
    myRole,
  });
  const [activeTab, setActiveTab] = useState("all");
  const [draft, setDraft] = useState("");
  const seenCounts = useRef({ all: 0, detectives: 0 });
  const [, forceRerender] = useState(0);
  const scrollRef = useRef(null);

  const messages = activeTab === "detectives" ? detectiveMessages : allMessages;
  const sendFn = activeTab === "detectives" ? sendToDetectives : sendToAll;

  const isScrolledToBottom = () => {
    const el = scrollRef.current;
    if (!el) return true; // no element yet (e.g. empty list) -- treat as "at bottom" so an empty tab doesn't start with a phantom unread
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };

  const markSeenIfAtBottom = () => {
    if (!isScrolledToBottom()) return;
    const liveCount = activeTab === "detectives" ? detectiveMessages.length : allMessages.length;
    if (seenCounts.current[activeTab] !== liveCount) {
      seenCounts.current[activeTab] = liveCount;
      forceRerender((n) => n + 1);
    }
  };

  // Force-scroll to bottom on initial mount and whenever the active tab
  // changes -- opening the chat (or switching tabs) should always show
  // the latest messages first, not leave you at wherever the scroll
  // position defaulted to (confirmed via testing: without this, a tab
  // with pre-existing message history opened scrolled to the TOP, not
  // the bottom, which is backwards from how a chat panel should behave).
  // Ordered BEFORE the "mark seen" effect below (React runs effects in
  // declaration order after each render): the seen-check reads the
  // current scroll position, so it needs this one to have already moved
  // it to the bottom on the same render pass, or a fresh mount / tab
  // switch would see scrollTop still at its old/default position and
  // wrongly conclude "not at bottom yet."
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Re-check on every message-count change (a new message arriving can
  // push the scroll position away from "true bottom" even if the user's
  // own scrollbar position hasn't moved) AND whenever the active tab
  // changes (switching to a tab should mark it seen if it's already
  // scrolled to bottom, which is the default/only state for a tab you
  // haven't scrolled up in).
  useEffect(() => {
    markSeenIfAtBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, allMessages.length, detectiveMessages.length]);

  // Auto-scroll to bottom on new messages, but ONLY if the user was
  // already at/near the bottom -- otherwise a message arriving while
  // they're reading older history would yank their scroll position away
  // from what they're reading, which is worse than just showing an
  // unread dot and letting them scroll down on their own when ready.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isScrolledToBottom()) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const hasUnread = (tab) => {
    const liveCount = tab === "detectives" ? detectiveMessages.length : allMessages.length;
    return liveCount > seenCounts.current[tab];
  };

  function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    sendFn(body).catch((e) => console.error("Failed to send message:", e));
  }

  return (
    <div style={{ ...styles.panel, height: CHAT_HEIGHT }}>
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            // Active tab highlighted with a distinct color per explicit
            // request (was a plain black underline before, easy to miss
            // at a glance) -- "All Players" gets a neutral dark-grey
            // highlight, "Detectives Only" gets green, so which channel
            // you're viewing is visually unambiguous even without reading
            // the label closely.
            ...(activeTab === "all" ? styles.tabActiveAll : {}),
          }}
          onClick={() => setActiveTab("all")}
        >
          All Players
          {hasUnread("all") && <span style={styles.unreadDot} />}
        </button>
        {canUseDetectiveChannel && (
          <button
            style={{
              ...styles.tab,
              ...(activeTab === "detectives" ? styles.tabActiveDetectives : {}),
            }}
            onClick={() => setActiveTab("detectives")}
          >
            Detectives Only
            {hasUnread("detectives") && <span style={styles.unreadDot} />}
          </button>
        )}
      </div>

      <div
        style={styles.messages}
        ref={scrollRef}
        onScroll={markSeenIfAtBottom}
      >
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
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck="false"
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
    width: "100%",
    display: "flex",
    flexDirection: "column",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    overflow: "hidden",
    height: 270,
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
    position: "relative",
  },
  // "All Players" active state: dark grey, since this is the neutral/
  // default channel everyone can see.
  tabActiveAll: { background: "#fff", color: "#111", borderBottom: "2px solid #4a4a4a" },
  // "Detectives Only" active state: green, so the private/restricted
  // channel is visually distinct from the public one at a glance, not
  // just distinguishable by reading the label.
  tabActiveDetectives: { background: "#fff", color: "#1a6b3c", borderBottom: "2px solid #2e8b52" },
  unreadDot: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#c0392b",
    marginLeft: 5,
    verticalAlign: "middle",
  },
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
