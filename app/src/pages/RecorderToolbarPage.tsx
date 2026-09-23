import { useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Rendered in its own small always-on-top companion BrowserWindow (see
 * registerIpc.ts's openToolbarWindow) while a recording session is live, so
 * "Stop Recording" and "Insert Random Value" are reachable without
 * switching back to the main Studio window — which, while the recorded
 * browser is in the foreground, is otherwise out of sight the whole time.
 */
export default function RecorderToolbarPage() {
  const [searchParams] = useSearchParams();
  const recordingId = searchParams.get("recordingId") ?? "";
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  async function handleInsertRandomValue() {
    if (!recordingId || isBusy) return;
    setIsBusy(true);
    setMessage(null);
    const res = await window.studio.recorderToolbar.insertRandomValue(recordingId);
    setIsBusy(false);
    if (!res.ok) {
      setMessage({ text: res.error, tone: "error" });
      return;
    }
    if (!res.data.ok) {
      setMessage({ text: res.data.reason ?? "Couldn't insert a value.", tone: "error" });
      return;
    }
    setMessage({ text: "Inserted — recorded as a random value.", tone: "ok" });
  }

  async function handleStop() {
    if (!recordingId || isStopping) return;
    setIsStopping(true);
    await window.studio.recorderToolbar.requestStop(recordingId);
    // The main window's Record Browser page owns the actual stop flow and
    // will close this window itself once it's done — see RecorderPage.tsx's
    // "externalStopRequested" handling and registerIpc.ts's closeToolbarWindow.
  }

  return (
    <div
      className="stack"
      style={{
        padding: 14,
        height: "100vh",
        boxSizing: "border-box",
        background: "var(--color-surface, #fff)",
        justifyContent: "space-between",
      }}
    >
      <div className="stack" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span
            style={{ width: 9, height: 9, borderRadius: "50%", background: "#d03b3b", display: "inline-block", flexShrink: 0 }}
          />
          <strong style={{ fontSize: 13 }}>Recording</strong>
        </div>
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          Click into a field, then Insert Random Value.
        </p>
      </div>

      {message && (
        <p style={{ fontSize: 11.5, margin: 0, color: message.tone === "error" ? "#d03b3b" : "#0ca30c" }}>{message.text}</p>
      )}

      <div className="stack" style={{ gap: 8 }}>
        <button onClick={() => void handleInsertRandomValue()} disabled={isBusy || isStopping} style={{ fontSize: 12.5 }}>
          🎲 Insert Random Value
        </button>
        <button className="primary" onClick={() => void handleStop()} disabled={isStopping} style={{ fontSize: 12.5 }}>
          {isStopping ? "Stopping…" : "⏹ Stop Recording"}
        </button>
      </div>
    </div>
  );
}
