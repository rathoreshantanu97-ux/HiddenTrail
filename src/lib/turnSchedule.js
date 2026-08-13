// ---------------------------------------------------------------------------
// TURN SCHEDULE — the single source of truth for turning the host's TWO
// numbers into the full timing schedule, using the two admin-controlled
// ratios and bounds. Shared by the host-facing preview
// (EditRoomSettingsForm) and the actual live game clock (useTurnTimer), so
// they can never drift apart.
//
// HOST INPUTS (two independent numbers, decoupled per explicit request --
// a host who wants 5 minutes of team thinking and still only 20 seconds to
// physically move needs to be able to say exactly that):
//   - actSeconds: the detective act window -- how long a detective gets
//     once it's genuinely their turn to move. Bounded by
//     [turnTimerMin, turnTimerMax] (unchanged from before).
//   - bufferSeconds: the shared pre-think buffer -- how long the whole
//     detective team gets to plan together right after Mr.X moves, before
//     anyone may commit a move. Set DIRECTLY by the host now (previously
//     derived as a multiple of actSeconds) -- bounded by
//     [planningTimeMin, planningTimeMax].
//
// ADMIN-ONLY DERIVED VALUES:
//   - mrxSeconds = ceil(bufferSeconds * mrxTimeRatio), then CLAMPED to
//     [mrxSecondsMin, mrxSecondsMax] -- Mr.X's own deliberation is the
//     same KIND of thing as the detectives' shared buffer (real thinking,
//     not quick execution), so it multiplies buffer time, not act time.
//     The clamp is a safety net requested explicitly, since a large ratio
//     times a large buffer could otherwise produce an unreasonable turn
//     length.
//     IF NO BUFFER IS CONFIGURED (host runs act-time-only, "each player
//     just gets their own turn timer, no shared thinking window"), there's
//     no buffer to multiply -- and multiplying actSeconds by mrxTimeRatio
//     instead would silently hand Mr.X a LONGER turn than everyone else
//     for no stated reason, which doesn't match that host's own intent (a
//     flat, equal-length turn for every seat). Per explicit design
//     decision, mrxSeconds in this mode is simply actSeconds itself --
//     same length as everyone else's turn, still clamped to the admin
//     bounds as a safety net.
//   - extraSeatSeconds -- how much EXTRA time the shared acting window
//     gets for each detective beyond the first that a single player
//     controls. Now a per-room, host-configurable number
//     (rooms.extra_detective_seconds), not a ratio-derived one: when the
//     room leaves it unset (null), it defaults to the full base
//     actSeconds, i.e. a player with three detectives gets three full
//     act windows' worth of room inside the shared phase. The older
//     ratio-derived value (ceil(actSeconds * extraSeatTimeRatio)) is
//     retained ONLY as the fallback shown in admin previews where no
//     room-level value exists to read; see extraSeatSecondsFromRatio.
//
// ROUNDING: every derived value is rounded UP (Math.ceil) before any
// clamping, per explicit instruction -- a player should never end up with
// LESS time than the ratio math implies just because of a fractional-
// second truncation.
// ---------------------------------------------------------------------------

export const DEFAULT_SCHEDULE_RATIOS = {
  mrxTimeRatio: 3,
  extraSeatTimeRatio: 0.5,
};

export const DEFAULT_SCHEDULE_BOUNDS = {
  mrxSecondsMin: 15,
  mrxSecondsMax: 900,
};

function clamp(n, min, max) {
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}

// computeTurnSchedule -- pure function, no I/O.
// extraDetectiveSeconds: the room's own configured top-up per additional
// detective controlled by one player (rooms.extra_detective_seconds).
// null/undefined means "not configured" -> defaults to the full base
// actSeconds, per the agreed default for this field.
export function computeTurnSchedule(actSeconds, bufferSeconds, ratios = {}, bounds = {}, extraDetectiveSeconds = null) {
  const r = { ...DEFAULT_SCHEDULE_RATIOS, ...ratios };
  const b = { ...DEFAULT_SCHEDULE_BOUNDS, ...bounds };
  if (!actSeconds || actSeconds <= 0) {
    return { actSeconds: null, bufferSeconds: null, mrxSeconds: null, extraSeatSeconds: null };
  }
  // bufferSeconds is optional -- a host may configure act-time-only, no
  // shared planning window (mirrors the existing "blank = no limit"
  // pattern for act time, applied here to mean "no buffer phase").
  const effectiveBuffer = bufferSeconds && bufferSeconds > 0 ? bufferSeconds : null;
  // No buffer configured -> Mr.X's turn is simply the same length as
  // everyone else's (actSeconds), not a ratio multiple of it -- see the
  // comment on mrxSeconds above for why.
  const mrxSecondsRaw = effectiveBuffer ? Math.ceil(effectiveBuffer * r.mrxTimeRatio) : actSeconds;
  const mrxSeconds = clamp(mrxSecondsRaw, b.mrxSecondsMin, b.mrxSecondsMax);
  const extraSeatSecondsFromRatio = Math.ceil(actSeconds * r.extraSeatTimeRatio);
  // Room-configured value wins; unset (null/undefined) falls back to a
  // FULL base act window per extra detective. 0 is a legitimate,
  // deliberate configuration ("no extra time at all"), so it must not be
  // treated as "unset" -- hence the explicit null check rather than a
  // truthiness test.
  const extraSeatSeconds =
    extraDetectiveSeconds != null && extraDetectiveSeconds >= 0 ? extraDetectiveSeconds : actSeconds;
  return { actSeconds, bufferSeconds: effectiveBuffer, mrxSeconds, extraSeatSeconds, extraSeatSecondsFromRatio };
}

// actingWindowSeconds -- ONE player's OWN acting pool (v3.27).
//
//   base act time + extraSeatSeconds * (that player's own detective count - 1)
//
// v3.24-v3.26 called this same function with the BUSIEST player's count
// and used the single number it returned as one shared round-level pool
// for everybody. That had two problems worth naming: a player with one
// detective silently inherited the busiest player's whole window (so the
// act time the host configured meant nothing to most seats), and nobody's
// tickets were forfeited until that one shared deadline passed, which
// made the slowest seat set the pace for the entire table.
//
// The math is unchanged -- what changed is WHOSE count gets passed in.
// Each player now computes their own pool from their own seat count, and
// their pool expiring forfeits only their own outstanding detectives'
// tickets (server-side: expire_acting_pools). The busiest player's value
// is still computed, but only as the round's outer SAFETY CAP -- see
// actingSafetyCapSeconds below.
//
// MUST stay in exact numerical agreement with the server's
// player_acting_pool_seconds(), which is the authority for the actual
// ticket forfeits; this copy only drives what the clock LOOKS like.
export function actingWindowSeconds(schedule, detectiveCountForThisPlayer) {
  if (!schedule || !schedule.actSeconds) return null;
  const n = Math.max(1, detectiveCountForThisPlayer || 1);
  return schedule.actSeconds + (schedule.extraSeatSeconds || 0) * (n - 1);
}

// actingSafetyCapSeconds -- the absolute outer bound on a round, sized
// off whoever holds the MOST detectives. Since every individual pool is
// computed by the same formula off a smaller-or-equal count, this is by
// construction never shorter than any individual pool, which is exactly
// what makes it a safe backstop.
//
// It deliberately drives NOTHING except the muted "round ends in…" line
// and the last-resort force_end_acting_phase call: no player's own
// timeout or ticket forfeit depends on it anymore. It exists so a round
// can never hang -- most concretely for detectives whose owning player
// row has vanished entirely (a seat freed mid-round), which the
// per-player sweep cannot reach by construction.
export function actingSafetyCapSeconds(schedule, maxDetectivesForAnyOnePlayer) {
  return actingWindowSeconds(schedule, maxDetectivesForAnyOnePlayer);
}
