// Minimal runtime overlay that shows the active sign / interaction message.
// DOM-only and runtime-only; the InteractionRuntime stays DOM-free and pushes
// text here through its onMessage callback. textContent (never innerHTML) so sign
// text is shown literally, never parsed as markup.

export class InteractionOverlay {
  constructor() {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      left: "50%",
      bottom: "48px",
      transform: "translateX(-50%)",
      maxWidth: "min(680px, 86vw)",
      padding: "12px 18px",
      zIndex: "30",
      color: "#eaf4ec",
      background: "rgba(8, 13, 11, 0.82)",
      border: "1px solid rgba(127,220,160,0.3)",
      borderRadius: "10px",
      backdropFilter: "blur(6px)",
      font: '14px/1.5 "SF Mono", ui-monospace, Menlo, Consolas, monospace',
      textAlign: "center",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 160ms ease",
      display: "none",
    });
    document.body.appendChild(this.root);
  }

  // Show literal text, or hide when message is null/empty.
  setMessage(message) {
    if (message) {
      this.root.textContent = message;
      this.root.style.display = "block";
      // Next frame so the transition runs.
      requestAnimationFrame(() => {
        this.root.style.opacity = "1";
      });
    } else {
      this.root.style.opacity = "0";
      this.root.style.display = "none";
    }
  }

  dispose() {
    this.root.remove();
  }
}
