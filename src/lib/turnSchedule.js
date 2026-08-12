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
//   - extraSeatSeconds = ceil(actSeconds * extraSeatTimeRatio) -- a
//     player's SECOND (and further) detective seat this round only gets
//     this smaller top-up, not another full act window, since the actual
//     thinking already happened during the buffer.
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
export function computeTurnSchedule(actSeconds, bufferSeconds, ratios = {}, bounds = {}) {
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
  const extraSeatSeconds = Math.ceil(actSeconds * r.extraSeatTimeRatio);
  return { actSeconds, bufferSeconds: effectiveBuffer, mrxSeconds, extraSeatSeconds };
}

// actSecondsForSeatIndex -- how long THIS specific seat's own act window
// should be, given it's the Nth (0-indexed) seat this SAME player is
// moving this round. Seat 0 (their first seat this round) gets the full
// base; every seat after that gets only the smaller extraSeatSeconds
// top-up, not another full base.
export function actSecondsForSeatIndex(schedule, seatIndexForPlayer) {
  if (!schedule.actSeconds) return null;
  return seatIndexForPlayer === 0 ? schedule.actSeconds : schedule.extraSeatSeconds;
}
