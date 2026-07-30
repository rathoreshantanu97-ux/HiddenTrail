import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// usePauseVote — mirrors useEndGameVote exactly (same proposal/vote
// pattern, different table). See that file's comments for the shared
// reasoning (polling instead of realtime, simplified-first-version voting).
// ---------------------------------------------------------------------------
export function usePauseVote({ roomId, myPlayerId }) {
  const [proposal, setProposal] = useState(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActivePauseProposal(roomId);
      setProposal(p);
    } catch (e) {
      console.error("Failed to fetch pause proposal:", e);
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
      await api.proposePause({ roomId, callerPlayerId: myPlayerId });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to propose pausing.");
      throw e;
    }
  }, [roomId, myPlayerId, refresh]);

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.votePause({ roomId, callerPlayerId: myPlayerId, proposalId: proposal.proposalId, vote: voteValue });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, proposal, refresh]
  );

  const iHaveVoted = proposal ? proposal.votedPlayerIds.includes(myPlayerId) : false;

  return { proposal, err, propose, vote, iHaveVoted };
}
