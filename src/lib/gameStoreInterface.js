// ---------------------------------------------------------------------------
// GAME STORE INTERFACE — the contract both stores implement, so App.jsx
// (and every screen/component under it) can be written once and work
// against either a same-device game or an online multiplayer game without
// knowing or caring which one it's talking to.
//
// Two implementations:
//   - localGameStore.js      same-device pass-and-play (React state only)
//   - supabaseGameStore.js   online multiplayer (Supabase Realtime-backed)
//
// A React hook of the shape below is what each store exports as its
// default/main export:
//
//   function useXGameStore(joinInfo) {
//     return {
//       match,                 // current match state (see gameEngine.js
//                               // for shape), or null if no game started yet
//       myRole,                 // "mrx" | "d0" | "d1" | ... | null
//                                 //  - local store: always null (not
//                                 //    role-restricted; the local device
//                                 //    sees/controls everyone, since it's
//                                 //    pass-and-play on one screen)
//                                 //  - supabase store: the role assigned to
//                                 //    THIS connected player, used to filter
//                                 //    what's rendered/clickable
//       isMultiplayer,           // false for local, true for supabase
//       startGame(config),       // config: { mapId, numDetectives,
//                                 //           detectiveNames? }
//       submitDetectiveMove(detId, to, mode),
//       submitMrXMove(to, edgeMode, ticketUsed),
//       activateDoubleMove(),
//       advanceLocalUIOnly,      // for local store: no-op passthrough;
//                                 // for supabase: not used (handoff screen
//                                 // doesn't apply online, each player has
//                                 // their own device/turn indicator instead)
//       resetToSetup(),          // return to the setup/lobby screen
//     };
//   }
//
// Everything NOT part of match state — zoom/pan, which ticket-chooser
// button is highlighted, pendingMove before it's committed — stays as
// plain useState INSIDE App.jsx regardless of which store is active. Only
// the actual game-state-that-must-be-shared-between-players goes through
// the store.
// ---------------------------------------------------------------------------

export const STORE_INTERFACE_VERSION = 1;
