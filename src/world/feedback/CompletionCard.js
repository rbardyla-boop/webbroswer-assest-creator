import { DEFAULT_SLICE_IDENTITY } from "../slice/SliceIdentity.js";

export class CompletionCard {
  constructor({ onExplore, onRestart, onCatalog, identity = DEFAULT_SLICE_IDENTITY } = {}) {
    this.element = document.createElement("section");
    this.element.className = "completion-card";
    // Slice-0A friction fix: a fresh tester finished, wanted to REPLAY, and picked "Keep Exploring"
    // (which sat first and silently did nothing). Make "Play Again" the obvious PRIMARY action, make
    // exploring a clearly-labelled secondary, and spell out what each choice does.
    //
    // Content-5: the slice NAME (h1) + ending line (the lead <p>) come from the resolved slice identity, set
    // via textContent below — never interpolated into innerHTML, since the identity can originate from
    // untrusted persisted localStorage. The default identity reproduces the original "The Frozen Cache" copy.
    this.element.innerHTML = `
      <div class="eyebrow">SLICE COMPLETE</div>
      <h1></h1>
      <p></p>
      <div class="completion-actions">
        <button data-action="restart" class="primary">↻ Play Again</button>
        <button data-action="explore" class="secondary">Keep Exploring</button>
      </div>
      <div class="completion-hint"><b>Play Again</b> restarts the slice from the beginning · <b>Keep Exploring</b> lets you roam the finished valley</div>`;
    this._title = this.element.querySelector("h1");
    this._body = this.element.querySelector("p");
    this.setIdentity(identity);
    this.element.querySelector('[data-action="explore"]').addEventListener("click", () => {
      this.hide();
      onExplore?.();
    });
    this.element.querySelector('[data-action="restart"]').addEventListener("click", () => onRestart?.());
    // Slice Select-1: when launched from the catalog, add a "return to the catalog" action. Appended ONLY when
    // onCatalog is supplied, so the card DOM is byte-identical for every slice launched any other way.
    if (onCatalog) {
      const catalogBtn = document.createElement("button");
      catalogBtn.dataset.action = "catalog";
      catalogBtn.className = "secondary";
      catalogBtn.textContent = "⌂ Slice Catalog";
      this.element.querySelector(".completion-actions").appendChild(catalogBtn);
      catalogBtn.addEventListener("click", () => onCatalog());
    }
    document.body.appendChild(this.element);
  }

  /** Apply the resolved slice identity (title + ending line). Idempotent; safe to call on every load. */
  setIdentity(identity = DEFAULT_SLICE_IDENTITY) {
    const id = identity ?? DEFAULT_SLICE_IDENTITY;
    this._title.textContent = typeof id.title === "string" && id.title.trim() !== "" ? id.title : DEFAULT_SLICE_IDENTITY.title;
    this._body.textContent = typeof id.completeBody === "string" && id.completeBody.trim() !== "" ? id.completeBody : DEFAULT_SLICE_IDENTITY.completeBody;
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
