import React from "react";

// ---------------------------------------------------------------------------
// ErrorBoundary — the app had NO error boundary anywhere before this, which
// meant any uncaught render exception (a typo'd variable, a bad map-override
// value, anything) unmounted the entire React tree and left the player
// staring at a blank white screen with zero indication of what went wrong.
// This catches that, shows the actual error (so it can be reported/fixed
// instead of guessed at), and offers a way back to the start screen instead
// of a dead end.
// ---------------------------------------------------------------------------
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Hidden Trail crashed:", error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { error } = this.state;
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.title}>Something went wrong</div>
          <div style={styles.body}>
            The screen hit an error and couldn't continue. This has been logged to the browser console
            (press F12 → Console to see the full details). Reloading usually fixes it.
          </div>
          <pre style={styles.errBox}>{String(error?.message || error)}</pre>
          <button style={styles.btn} onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f7f6f3",
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: 20,
  },
  card: {
    maxWidth: 480,
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: 800, marginBottom: 8, color: "#c0392b" },
  body: { fontSize: 13.5, color: "#5c5648", lineHeight: 1.6, marginBottom: 14 },
  errBox: {
    background: "#fdecea",
    border: "1px solid #e0a8a8",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12,
    color: "#a33",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    marginBottom: 16,
  },
  btn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    width: "100%",
  },
};
