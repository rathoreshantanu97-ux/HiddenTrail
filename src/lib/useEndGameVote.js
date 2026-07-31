import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useEndGameVote — polls for an active end-game proposal in this room
// every 2s (simple polling, same reasoning as chat -- a vote with a 60s
// window doesn't need realtime-precision updates, and this avoids a
// second realtime subscription just for this). Exposes the current
// proposal state (if any) plus propose/vote actions.
// ---------------------------------------------------------------------------
export function useEndGameVote({ roomId, myPlayerId }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActiveEndGameProposal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({ roomId, voteTable: "end_game_votes", proposalId: p.proposalId });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch end-game proposal:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  const propose = useCallback(async () => {
    setErr("");
    try {
      await api.proposeEndGame({ roomId, callerPlayerId: myPlayerId });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to propose ending the game.");
      throw e;
    }
  }, [roomId, myPlayerId, refresh]);

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.voteEndGame({ roomId, callerPlayerId: myPlayerId, proposalId: proposal.proposalId, vote: voteValue });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, proposal, refresh]
  );

  const iHaveVoted = proposal ? proposal.votedPlayerIds.includes(myPlayerId) : false;

  return { proposal, statusList, err, propose, vote, iHaveVoted };
}
