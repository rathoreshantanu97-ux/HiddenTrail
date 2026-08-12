// ---------------------------------------------------------------------------
// TURN SCHEDULE — the single source of truth for turning the host's ONE
// number (turn_timer_seconds, the "detective act window") into the full
// timing schedule, using the three admin-controlled ratios. Shared by the
// host-facing preview (EditRoomSettingsForm) and the actual live game
// clock (useTurnTimer), so they can never drift apart.
//
// DESIGN (see the long back-and-forth that led here): real in-person play
// isn't "everyone gets an identical private clock" -- most of the actual
// thinking happens continuously while it ISN'T your turn, and the moment
// it becomes your turn is mostly just executing a decision you already
// made. That reshapes the schedule into three pieces:
//
//   1. Mr. X's turn -- one dedicated window. Mr. X has no teammates to
//      split deliberation with, so this needs to BE the primary thinking
//      time, not a small top-up on a detective's short act window --
//      sized to roughly the same order as the detectives' shared buffer
//      below, via mrxTimeRatio (admin-set, default 3x the act window).
//
//   2. The pre-think buffer -- ONE shared countdown for the whole
//      detective team, starting the instant Mr. X's move resolves.
//      Nobody can submit a move during this window (they CAN preview
//      reachable stations for any detective via the existing explore/
//      huddle system) -- this is where the real collective planning
//      happens, which is why it's sized LARGER than any individual's
//      later act window, via preThinkBufferRatio (admin-set, default 3x).
//
//   3. Each detective's act window -- short, since the thinking already
//      happened in the buffer. A player controlling more than one seat
//      does NOT get a flat multiple (2 seats != 2x time) -- their first
//      seat this round gets the full base act window (they still need to
//      physically execute that first decision), and every ADDITIONAL
//      seat they personally control only adds a fraction of the base,
//      via extraSeatTimeRatio (admin-set, default 0.5x) -- reflecting
//      that by the time you're moving your second detective, you already
//      decided both moves during the shared buffer.
//
// ROUNDING: every derived value is rounded UP (Math.ceil), per explicit
// instruction -- a player should never end up with LESS time than the
// ratio math implies just because of a fractional-second truncation.
// ---------------------------------------------------------------------------

export const DEFAULT_SCHEDULE_RATIOS = {
  preThinkBufferRatio: 3,
  mrxTimeRatio: 3,
  extraSeatTimeRatio: 0.5,
};

// computeTurnSchedule -- pure function, no I/O. `actSeconds` is the host's
// one configured number (turn_timer_seconds). Returns everything derived
// from it plus the three ratios.
export function computeTurnSchedule(actSeconds, ratios = {}) {
  const r = { ...DEFAULT_SCHEDULE_RATIOS, ...ratios };
  if (!actSeconds || actSeconds <= 0) {
    return { actSeconds: null, mrxSeconds: null, bufferSeconds: null, extraSeatSeconds: null };
  }
  const mrxSeconds = Math.ceil(actSeconds * r.mrxTimeRatio);
  const bufferSeconds = Math.ceil(actSeconds * r.preThinkBufferRatio);
  const extraSeatSeconds = Math.ceil(actSeconds * r.extraSeatTimeRatio);
  return { actSeconds, mrxSeconds, bufferSeconds, extraSeatSeconds };
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
