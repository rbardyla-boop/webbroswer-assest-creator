export class InputManager {
  constructor(domElement = document.body, { enableTouch = true, pointerLock = true } = {}) {
    this.dom = domElement;
    this.pointerLockEnabled = pointerLock;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this.touch = {
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      jump: false,
      sprint: false,
      action: false,
      brake: false,
      up: false,
      down: false,
    };

    this._onKeyDown = (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (this._shouldPrevent(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
      if (this._shouldPrevent(e.code)) e.preventDefault();
    };
    this._onMouseMove = (e) => {
      if (!this.pointerLocked && this.pointerLockEnabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onClick = () => {
      if (this.pointerLockEnabled && document.pointerLockElement !== this.dom) {
        this.dom.requestPointerLock?.();
      }
    };
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp, { passive: false });
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this.dom.addEventListener('click', this._onClick);

    this.touchControls = enableTouch ? new TouchControls(this) : null;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.dom.removeEventListener('click', this._onClick);
    this.touchControls?.dispose();
  }

  beginFrame() {
    // Edge sets are consumed manually so late readers do not miss them.
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.touch.lookX = 0;
    this.touch.lookY = 0;
  }

  isDown(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  consumeMouseDelta() {
    const out = {
      x: this.mouseDX + this.touch.lookX,
      y: this.mouseDY + this.touch.lookY,
    };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  getMoveAxis() {
    let x = this.touch.moveX;
    let y = this.touch.moveY;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    return normalizeAxis(x, y);
  }

  getLookAxis() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyJ')) x -= 1;
    if (this.keys.has('KeyL')) x += 1;
    if (this.keys.has('KeyI')) y += 1;
    if (this.keys.has('KeyK')) y -= 1;
    return normalizeAxis(x, y);
  }

  jumpHeld() {
    return this.keys.has('Space') || this.touch.jump;
  }

  jumpPressed() {
    return this.wasPressed('Space') || this.touchControls?.consumeButtonPress('jump') || false;
  }

  sprintHeld() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.sprint;
  }

  actionPressed() {
    return this.wasPressed('KeyE') || this.touchControls?.consumeButtonPress('action') || false;
  }

  brakeHeld() {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.touch.brake;
  }

  upHeld() {
    return this.keys.has('Space') || this.touch.up || this.touch.jump;
  }

  downHeld() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touch.down || this.touch.sprint;
  }

  _shouldPrevent(code) {
    return code.startsWith('Arrow') || code === 'Space';
  }
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.enabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.buttonPresses = new Set();
    this.active = new Map();
    if (!this.enabled) return;
    this.root = document.createElement('div');
    this.root.className = 'ptc-touch';
    this.root.innerHTML = `
      <div class="ptc-stick ptc-move"><div></div></div>
      <div class="ptc-stick ptc-look"><div></div></div>
      <button data-btn="jump">JUMP</button>
      <button data-btn="sprint">RUN</button>
      <button data-btn="action">ACT</button>
    `;
    document.body.appendChild(this.root);
    this.moveStick = this.root.querySelector('.ptc-move');
    this.lookStick = this.root.querySelector('.ptc-look');
    this.knobs = {
      move: this.moveStick.firstElementChild,
      look: this.lookStick.firstElementChild,
    };
    this._bindStick(this.moveStick, 'move');
    this._bindStick(this.lookStick, 'look');
    for (const btn of this.root.querySelectorAll('button')) {
      const name = btn.dataset.btn;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.touch[name] = true;
        this.buttonPresses.add(name);
        btn.setPointerCapture(e.pointerId);
      });
      btn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        this.input.touch[name] = false;
      });
      btn.addEventListener('pointercancel', () => {
        this.input.touch[name] = false;
      });
    }
  }

  dispose() {
    this.root?.remove();
  }

  consumeButtonPress(name) {
    if (!this.buttonPresses.has(name)) return false;
    this.buttonPresses.delete(name);
    return true;
  }

  _bindStick(el, type) {
    const state = { id: null, x: 0, y: 0 };
    const limit = 52;
    const setAxis = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      let x = clientX - (r.left + r.width / 2);
      let y = clientY - (r.top + r.height / 2);
      const len = Math.hypot(x, y);
      if (len > limit) {
        x = (x / len) * limit;
        y = (y / len) * limit;
      }
      const nx = x / limit;
      const ny = -y / limit;
      if (type === 'move') {
        this.input.touch.moveX = nx;
        this.input.touch.moveY = ny;
      } else {
        this.input.touch.lookX += nx * 7;
        this.input.touch.lookY += -ny * 7;
      }
      this.knobs[type].style.transform = `translate(${x}px, ${y}px)`;
    };
    const clear = () => {
      if (type === 'move') {
        this.input.touch.moveX = 0;
        this.input.touch.moveY = 0;
      }
      this.knobs[type].style.transform = 'translate(0px, 0px)';
      state.id = null;
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      setAxis(e.clientX, e.clientY);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== state.id) return;
      e.preventDefault();
      setAxis(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
  }
}

function normalizeAxis(x, y) {
  const len = Math.hypot(x, y);
  if (len > 1) return { x: x / len, y: y / len };
  return { x, y };
}
