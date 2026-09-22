/** A lightweight confirmation modal for destructive actions (delete project/test/etc). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {message}
        </p>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onCancel}>Cancel</button>
          <button className={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
