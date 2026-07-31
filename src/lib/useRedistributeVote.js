import { useState, useEffect, useCallback } from "react";
import * as api from "./supabaseApi.js";

// ---------------------------------------------------------------------------
// useRedistributeVote — mirrors the other vote hooks. propose() takes a
// full {playerId: newRole} assignment map (built by the host's UI), not
// just a simple action -- server-side validation (propose_redistribute_roles)
// enforces it covers every player and every seat exactly once.
// ---------------------------------------------------------------------------
export function useRedistributeVote({ roomId, myPlayerId }) {
  const [proposal, setProposal] = useState(null);
  const [statusList, setStatusList] = useState([]);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    if (!roomId) return;
    try {
      const p = await api.getActiveRedistributeProposal(roomId);
      setProposal(p);
      if (p) {
        const list = await api.getVoteStatusList({ roomId, voteTable: "redistribute_votes", proposalId: p.proposalId });
        setStatusList(list);
      } else {
        setStatusList([]);
      }
    } catch (e) {
      console.error("Failed to fetch redistribute proposal:", e);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [roomId, refresh]);

  const propose = useCallback(
    async (newAssignments) => {
      setErr("");
      try {
        await api.proposeRedistributeRoles({ roomId, callerPlayerId: myPlayerId, newAssignments });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to propose redistributing roles.");
        throw e;
      }
    },
    [roomId, myPlayerId, refresh]
  );

  const vote = useCallback(
    async (voteValue) => {
      if (!proposal) return;
      setErr("");
      try {
        await api.voteRedistributeRoles({ roomId, callerPlayerId: myPlayerId, proposalId: proposal.proposalId, vote: voteValue });
        await refresh();
      } catch (e) {
        setErr(e.message || "Failed to submit your vote.");
        throw e;
      }
    },
    [roomId, myPlayerId, proposal, refresh]
  );

  const iHaveVoted = statusList.some((p) => p.playerId === myPlayerId && p.status !== "pending");

  return { proposal, statusList, err, propose, vote, iHaveVoted };
}
