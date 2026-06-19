export class CompletionCard {
  constructor({ onExplore, onRestart } = {}) {
    this.element = document.createElement("section");
    this.element.className = "completion-card";
    this.element.innerHTML = `
      <div class="eyebrow">SLICE COMPLETE</div>
      <h1>The Frozen Cache</h1>
      <p>The relic is secure. Its trophy remains in the valley.</p>
      <div class="completion-actions"><button data-action="explore">Keep Exploring</button><button data-action="restart">Restart Slice</button></div>`;
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
