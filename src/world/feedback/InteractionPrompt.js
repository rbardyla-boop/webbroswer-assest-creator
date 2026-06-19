export class InteractionPrompt {
  constructor(parent = document.body) {
    this.element = document.createElement("div");
    this.element.className = "interaction-prompt";
    this.element.innerHTML = '<kbd></kbd><span></span>';
    parent.appendChild(this.element);
  }

  show(prompt) {
    this.element.classList.toggle("visible", !!prompt);
    if (!prompt) return;
    this.element.querySelector("kbd").textContent = prompt.key;
    this.element.querySelector("span").textContent = prompt.text;
  }

  dispose() {
    this.element.remove();
  }
}
