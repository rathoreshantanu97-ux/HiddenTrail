import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useTakeoverReversalVote — mirrors useEndGameVote/usePauseVote exactly
// (same proposal/vote/status-list pattern). One difference: propose()
// here needs a takeoverEventId (the specific completed takeover being
// contested), not just a room -- only the player who was actually
// replaced by that takeover can propose reversing it (enforced
// server-side in propose_takeover_reversal).
// ---------------------------------------------------------------------------
export function useTakeoverReversalVote({ roomId, myPlayerId, mySecret }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActiveTakeoverReversal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({
          roomId,
          voteTable: "takeover_reversal_votes",
          proposalId: p.proposalId,
        });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch takeover reversal proposal:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  const propose = useCallback(
    async (takeoverEventId) => {
      setErr("");
      try {
        await api.proposeTakeoverReversal({ roomId, callerPlayerId: myPlayerId, callerSecret: mySecret, takeoverEventId });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to propose a reversal.");
        throw e;
      }
    },
    [roomId, myPlayerId, mySecret, refresh]
  );

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.voteTakeoverReversal({
          roomId,
          callerPlayerId: myPlayerId,
          callerSecret: mySecret,
          proposalId: proposal.proposalId,
          vote: voteValue,
        });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, mySecret, proposal, refresh]
  );

  const iHaveVoted = statusList.some((p) => p.playerId === myPlayerId && p.status !== "pending");

  return { proposal, statusList, err, propose, vote, iHaveVoted };
}
