// Centralized input. Owns keyboard state, mouse-look deltas, and pointer-lock.
// Movement/camera code reads from here; it never touches the DOM directly.

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this._pressedThisFrame = new Set(); // edge events, cleared each frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onCanvasClick = this._onCanvasClick.bind(this);

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    this.dom.addEventListener("click", this._onCanvasClick);
  }

  // Edge trigger for toggles, consume-on-read: returns true once per physical
  // press, then clears it. Consuming (rather than time-clearing each frame)
  // avoids dropping a press that lands between a reader's update() and the end
  // of the frame. Each toggle key must have a single reader.
  wasPressed(code) {
    if (this._pressedThisFrame.has(code)) {
      this._pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  isDown(code) {
    return this.keys.has(code);
  }

  // Movement axes in local space. forward: W/S, strafe: A/D.
  getMoveAxis() {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) forward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) forward -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) strafe += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) strafe -= 1;
    return { forward, strafe };
  }

  // Consume accumulated mouse motion (call once per frame).
  consumeMouseDelta() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  requestPointerLock() {
    if (!this.pointerLocked) this.dom.requestPointerLock?.();
  }

  // --- handlers ---------------------------------------------------------------

  _onKeyDown(e) {
    if (!this.keys.has(e.code)) this._pressedThisFrame.add(e.code);
    this.keys.add(e.code);
    // Stop space/arrows from scrolling the page while playing.
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
  }

  _onMouseMove(e) {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX || 0;
    this.mouseDY += e.movementY || 0;
  }

  _onPointerLockChange() {
    this.pointerLocked = document.pointerLockElement === this.dom;
  }

  _onCanvasClick() {
    this.requestPointerLock();
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    this.dom.removeEventListener("click", this._onCanvasClick);
  }
}
