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

// actingWindowSeconds -- the TOTAL length of the shared acting phase.
// The phase runs concurrently for every player, but each player works
// through their OWN detectives sequentially inside it (see GameBoard's
// sub-turn model), so the window has to be long enough for whichever
// single player has the most detectives to get through all of theirs:
//
//   base act time + extraSeatSeconds * (maxDetectivesForAnyOnePlayer - 1)
//
// A player with fewer detectives simply finishes early and waits -- the
// window is deliberately sized for the slowest case, not averaged, since
// cutting the busiest player off mid-sequence would be a correctness
// problem, not just an inconvenience.
export function actingWindowSeconds(schedule, maxDetectivesForAnyOnePlayer) {
  if (!schedule || !schedule.actSeconds) return null;
  const n = Math.max(1, maxDetectivesForAnyOnePlayer || 1);
  return schedule.actSeconds + (schedule.extraSeatSeconds || 0) * (n - 1);
}
