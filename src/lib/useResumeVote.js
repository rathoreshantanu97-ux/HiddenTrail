import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useResumeVote — mirrors usePauseVote exactly (same proposal/vote
// pattern, different table). Built to fix a real, confirmed gap: resuming
// after a pause previously let any single player unilaterally resume,
// unlike every other consequential group action in this game. Per
// explicit instruction, resuming now requires the same full-agreement
// vote as pausing itself.
// ---------------------------------------------------------------------------
export function useResumeVote({ roomId, myPlayerId }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActiveResumeProposal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({ roomId, voteTable: "resume_votes", proposalId: p.proposalId });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch resume proposal:", e);
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
      await api.proposeResume({ roomId, callerPlayerId: myPlayerId });
      await refresh();
    } catch (e) {
      setErr(e.message || "Failed to propose resuming.");
      throw e;
    }
  }, [roomId, myPlayerId, refresh]);

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.voteResume({ roomId, callerPlayerId: myPlayerId, proposalId: proposal.proposalId, vote: voteValue });
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
