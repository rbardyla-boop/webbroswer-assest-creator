export class CompletionCard {
  constructor({ onExplore, onRestart } = {}) {
    this.element = document.createElement("section");
    this.element.className = "completion-card";
    // Slice-0A friction fix: a fresh tester finished, wanted to REPLAY, and picked "Keep Exploring"
    // (which sat first and silently did nothing). Make "Play Again" the obvious PRIMARY action, make
    // exploring a clearly-labelled secondary, and spell out what each choice does.
    this.element.innerHTML = `
      <div class="eyebrow">SLICE COMPLETE</div>
      <h1>The Frozen Cache</h1>
      <p>The relic is secure. Its trophy remains in the valley.</p>
      <div class="completion-actions">
        <button data-action="restart" class="primary">↻ Play Again</button>
        <button data-action="explore" class="secondary">Keep Exploring</button>
      </div>
      <div class="completion-hint"><b>Play Again</b> restarts the slice from the beginning · <b>Keep Exploring</b> lets you roam the finished valley</div>`;
    this.element.querySelector('[data-action="explore"]').addEventListener("click", () => {
      this.hide();
      onExplore?.();
    });
    this.element.querySelector('[data-action="restart"]').addEventListener("click", () => onRestart?.());
    document.body.appendChild(this.element);
  }

  show() {
    this.element.classList.add("visible");
  }

  hide() {
    this.element.classList.remove("visible");
  }

  get visible() {
    return this.element.classList.contains("visible");
  }

  dispose() {
    this.element.remove();
  }
}
