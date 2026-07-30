import React, { useState, useEffect } from "react";
import AuthScreen from "./AuthScreen.jsx";
import * as auth from "../lib/accessControlApi.js";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";

// ---------------------------------------------------------------------------
// AUTH GATE — nothing else in the app renders until this resolves.
//
// Resolution order on load:
//   1. If Supabase isn't configured at all (local dev, no .env.local),
//      skip the gate entirely -- pass-and-play still works with zero setup.
//   2. If a valid account session exists, restore it silently.
//   3. If a guest flag exists AND the app is currently in public mode,
//      restore the guest session. If the app has since been switched back
//      to private mode, the guest flag is cleared and ignored -- guests
//      only persist across a reload while public mode stays on.
//   4. Otherwise, show AuthScreen (which itself checks public-mode status
//      to decide whether to offer "Continue as Guest").
// ---------------------------------------------------------------------------
export default function AuthGate({ children }) {
  const [status, setStatus] = useState("checking"); // "checking" | "authenticated" | "unauthenticated"
  const [account, setAccount] = useState(null); // { accountId, displayName } for real accounts, or { isGuest: true, displayName } for guests

  useEffect(() => {
    async function resolve() {
      if (!isSupabaseConfigured()) {
        setStatus("authenticated");
        return;
      }

      const sessionResult = await auth.validateStoredSession();
      if (sessionResult) {
        setAccount(sessionResult);
        setStatus("authenticated");
        return;
      }

      const guest = auth.getGuestSession();
      if (guest) {
        const isPublic = await auth.getAppPublicStatus().catch(() => false);
        if (isPublic) {
          setAccount({ isGuest: true, displayName: guest.displayName });
          setStatus("authenticated");
          return;
        }
        // app is no longer public -- an old guest flag doesn't grant access anymore
        auth.clearGuestSession();
      }

      setStatus("unauthenticated");
    }
    resolve();
  }, []);

  function handleAuthenticated(result) {
    setAccount(result);
    setStatus("authenticated");
  }

  async function handleLogout() {
    await auth.logout(); // clears both a real session token and the guest flag, whichever applies
    setAccount(null);
    setStatus("unauthenticated");
  }

  if (status === "checking") {
    return <div style={{ padding: 40, textAlign: "center", fontFamily: "system-ui" }}>Loading...</div>;
  }

  if (status === "unauthenticated") {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return children(account, handleLogout);
}
