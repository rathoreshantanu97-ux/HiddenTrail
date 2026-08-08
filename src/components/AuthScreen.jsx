import React, { useState, useEffect } from "react";
import * as auth from "../lib/accessControlApi.js";

// ---------------------------------------------------------------------------
// AUTH SCREEN — shown when there's no valid session. Top-level choice is
// Sign In vs Sign Up; Sign Up then splits into two paths:
//   - Invite code from a friend -> instant account, no admin involved
//   - Request access from the admin -> OTP relay, then set a password
// Guest (only offered in public mode) is reachable from the Sign In view
// as a lower-emphasis option, since it's not really "signing up."
// ---------------------------------------------------------------------------
export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("landing"); // "landing" | "login" | "signupChoice" | "request" | "verify" | "setPassword" | "inviteSignup" | "guest"
  const [isPublic, setIsPublic] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [requestId, setRequestId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    auth.getAppPublicStatus().then(setIsPublic).catch(() => setIsPublic(false));
  }, []);

  function switchMode(next) {
    setMode(next);
    setErr("");
    setInfo("");
  }

  async function handleLogin() {
    setBusy(true);
    setErr("");
    try {
      const result = await auth.login({ username: username.trim(), password });
      onAuthenticated(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestAccess() {
    setBusy(true);
    setErr("");
    try {
      await auth.requestAccess({ username: username.trim(), displayName: displayName.trim() });
      setInfo("Request sent. The admin will share a one-time code with you directly.");
      setMode("verify");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setBusy(true);
    setErr("");
    try {
      const result = await auth.verifyOtp({ username: username.trim(), otp: otp.trim() });
      setRequestId(result.requestId);
      setMode("setPassword");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const result = await auth.completeSignup({ requestId, password });
      onAuthenticated(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInviteSignup() {
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const result = await auth.signupWithInviteCode({
        inviteCode: inviteCode.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
      });
      onAuthenticated(result);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleGuestContinue() {
    if (!displayName.trim()) {
      setErr("Enter a name to continue.");
      return;
    }
    auth.startGuestSession(displayName.trim());
    onAuthenticated({ isGuest: true, displayName: displayName.trim() });
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Hidden Trail</h1>
        <p style={styles.subtitle}>
          {mode === "landing" && "Sign in or create an account"}
          {mode === "login" && "Sign in to play"}
          {mode === "signupChoice" && "How would you like to sign up?"}
          {mode === "request" && "Request access"}
          {mode === "verify" && "Enter your one-time code"}
          {mode === "setPassword" && "Choose a password"}
          {mode === "inviteSignup" && "Sign up with an invite code"}
          {mode === "guest" && "Continue as guest"}
        </p>

        {info && <div style={styles.infoText}>{info}</div>}
        {err && <div style={styles.errText}>{err}</div>}

        {mode === "landing" && (
          <div style={styles.form}>
            <button style={styles.primaryBtn} onClick={() => switchMode("login")}>
              Sign In
            </button>
            <button style={styles.secondaryBtn} onClick={() => switchMode("signupChoice")}>
              Sign Up
            </button>
            {isPublic && (
              <button style={styles.linkBtn} onClick={() => switchMode("guest")}>
                Continue as guest
              </button>
            )}
          </div>
        )}

        {mode === "signupChoice" && (
          <div style={styles.form}>
            <button style={styles.choiceCard} onClick={() => switchMode("inviteSignup")}>
              <div style={styles.choiceCardTitle}>I have an invite code</div>
              <div style={styles.choiceCardDesc}>
                A friend with an account shared a code with you. Sign up instantly, no waiting.
              </div>
            </button>
            <button style={styles.choiceCard} onClick={() => switchMode("request")}>
              <div style={styles.choiceCardTitle}>Request access from the admin</div>
              <div style={styles.choiceCardDesc}>
                Don't have a code? Ask the admin directly — they'll send you a one-time code to get started.
              </div>
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("landing")}>
              Back
            </button>
          </div>
        )}

        {mode === "login" && (
          <div style={styles.form}>
            <label style={styles.label}>Username</label>
            <input style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} />
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
            <button style={styles.primaryBtn} onClick={handleLogin} disabled={busy}>
              {busy ? "Signing in..." : "Sign In"}
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("landing")}>
              Back
            </button>
          </div>
        )}

        {mode === "inviteSignup" && (
          <div style={styles.form}>
            <label style={styles.label}>Invite code</label>
            <input
              style={{ ...styles.input, textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="e.g. AB12CD34"
              maxLength={8}
            />
            <label style={styles.label}>Your name</label>
            <input style={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Priya" />
            <label style={styles.label}>Choose a username</label>
            <input
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="lowercase letters, numbers, underscores"
            />
            <label style={styles.label}>Choose a password (min 8 characters)</label>
            <input style={styles.input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button style={styles.primaryBtn} onClick={handleInviteSignup} disabled={busy}>
              {busy ? "Creating account..." : "Create Account"}
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("signupChoice")}>
              Back
            </button>
          </div>
        )}

        {mode === "request" && (
          <div style={styles.form}>
            <label style={styles.label}>Your name</label>
            <input style={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Priya" />
            <label style={styles.label}>Choose a username</label>
            <input
              style={styles.input}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="lowercase letters, numbers, underscores"
            />
            <button style={styles.primaryBtn} onClick={handleRequestAccess} disabled={busy}>
              {busy ? "Sending..." : "Request Access"}
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("signupChoice")}>
              Back
            </button>
          </div>
        )}

        {mode === "verify" && (
          <div style={styles.form}>
            <label style={styles.label}>One-time code</label>
            <input
              style={{ ...styles.input, letterSpacing: 4, fontWeight: 700, textAlign: "center" }}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              maxLength={6}
              placeholder="000000"
            />
            <button style={styles.primaryBtn} onClick={handleVerifyOtp} disabled={busy}>
              {busy ? "Verifying..." : "Verify Code"}
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("request")}>
              Back
            </button>
          </div>
        )}

        {mode === "setPassword" && (
          <div style={styles.form}>
            <label style={styles.label}>Choose a password (min 8 characters)</label>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
            />
            <button style={styles.primaryBtn} onClick={handleSetPassword} disabled={busy}>
              {busy ? "Creating account..." : "Create Account"}
            </button>
          </div>
        )}

        {mode === "guest" && (
          <div style={styles.form}>
            <label style={styles.label}>Your name</label>
            <input
              style={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Priya"
              onKeyDown={(e) => e.key === "Enter" && handleGuestContinue()}
            />
            <button style={styles.primaryBtn} onClick={handleGuestContinue}>
              Continue
            </button>
            <button style={styles.linkBtn} onClick={() => switchMode("landing")}>
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  choiceCard: {
    textAlign: "left",
    border: "1.5px solid #ddd",
    background: "#fff",
    borderRadius: 12,
    padding: "14px 16px",
    cursor: "pointer",
    marginTop: 6,
  },
  choiceCardTitle: { fontWeight: 700, fontSize: 14.5, marginBottom: 3 },
  choiceCardDesc: { fontSize: 12.5, color: "#777", lineHeight: 1.4 },
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    background: "#f7f6f3",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: 28,
    maxWidth: 400,
    width: "100%",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
    textAlign: "center",
  },
  title: { margin: "0 0 4px", fontSize: 26 },
  subtitle: { color: "#777", marginBottom: 18, fontSize: 14 },
  form: { display: "flex", flexDirection: "column", gap: 6, textAlign: "left" },
  label: { fontSize: 13, color: "#555", fontWeight: 600, marginTop: 8 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14 },
  primaryBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 12,
  },
  secondaryBtn: {
    background: "#fff",
    color: "#111",
    border: "1.5px solid #ddd",
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 4,
  },
  divider: { borderTop: "1px solid #eee", margin: "12px 0 2px" },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#888",
    marginTop: 8,
    cursor: "pointer",
    fontSize: 13,
    textDecoration: "underline",
  },
  infoText: { fontSize: 13, color: "#2563eb", background: "#eef4ff", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
  errText: { fontSize: 13, color: "#c0392b", background: "#fdecea", borderRadius: 8, padding: "8px 10px", marginBottom: 10 },
};
