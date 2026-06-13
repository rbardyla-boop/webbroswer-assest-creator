// In-browser "2D → 3D relief" editor.
//
// Draw on the canvas OR drop in a photo; the editor reads the source raster's
// luminance as height and its color per-vertex, building an orbitable 3D relief
// mesh in its own little viewport. Standalone from the playable world.
//
// It owns its own WebGL renderer + a minimal orbit controller, and only spins
// its render loop while open. The host can pause the main scene meanwhile.

import * as THREE from "three";

const SOURCE_RES = 256; // internal source canvas resolution

export class ReliefEditor {
  constructor({ onOpen, onClose } = {}) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;

    this.heightScale = 9;
    this.segments = 160;
    this.smoothing = 1;
    this.invert = false;

    this._three = null;
    this._raf = 0;
    this._needsGenerate = false;
    this._painting = false;
    this._lastPaint = null;

    this._buildDOM();
    this._initSourceCanvas();
  }

  // --- public ----------------------------------------------------------------

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.style.display = "grid";
    if (!this._three) this._initThree();
    this._resizeViewport();
    if (this._needsGenerate) this._generate();
    this._startLoop();
    this.onOpen?.();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.style.display = "none";
    this._stopLoop();
    this.onClose?.();
  }

  // --- DOM --------------------------------------------------------------------

  _buildDOM() {
    const root = document.createElement("div");
    root.id = "relief-editor";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "40",
      display: "none",
      gridTemplateColumns: "300px 1fr",
      background: "rgba(8, 11, 10, 0.94)",
      backdropFilter: "blur(4px)",
      color: "#d7e6dc",
      font: '12px/1.5 "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    });

    // Left control column.
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      padding: "18px 16px",
      borderRight: "1px solid rgba(120,200,140,0.18)",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    });
    panel.innerHTML = `
      <div style="font-size:13px;letter-spacing:.14em;color:#7fdca0">RELIEF EDITOR</div>
      <div style="color:#8fa899;font-size:11px">Draw below or load a photo. Luminance becomes height; color is sampled per vertex.</div>
    `;

    // Source canvas (draw + image target).
    const canvasWrap = document.createElement("div");
    Object.assign(canvasWrap.style, { position: "relative", alignSelf: "center" });
    this.sourceCanvas = document.createElement("canvas");
    this.sourceCanvas.width = SOURCE_RES;
    this.sourceCanvas.height = SOURCE_RES;
    Object.assign(this.sourceCanvas.style, {
      width: "256px",
      height: "256px",
      borderRadius: "8px",
      border: "1px solid rgba(120,200,140,0.25)",
      cursor: "crosshair",
      touchAction: "none",
      background: "#111",
    });
    canvasWrap.appendChild(this.sourceCanvas);
    panel.appendChild(canvasWrap);

    panel.appendChild(this._row("Load photo", this._fileInput()));
    panel.appendChild(
      this._slider("Height", 1, 24, this.heightScale, 0.5, (v) => {
        this.heightScale = v;
        this._scheduleGenerate();
      })
    );
    panel.appendChild(
      this._slider("Detail (res)", 32, 280, this.segments, 1, (v) => {
        this.segments = Math.round(v);
        this._scheduleGenerate();
      })
    );
    panel.appendChild(
      this._slider("Smoothing", 0, 6, this.smoothing, 1, (v) => {
        this.smoothing = Math.round(v);
        this._scheduleGenerate();
      })
    );

    // Buttons row.
    const btnRow = document.createElement("div");
    Object.assign(btnRow.style, { display: "flex", gap: "8px", flexWrap: "wrap" });
    btnRow.appendChild(this._button("Generate", () => this._generate()));
    btnRow.appendChild(this._button("Invert", () => { this.invert = !this.invert; this._generate(); }));
    btnRow.appendChild(this._button("Clear", () => this._clearSource()));
    btnRow.appendChild(this._button("✕ Close", () => this.close()));
    panel.appendChild(btnRow);

    const hint = document.createElement("div");
    hint.style.color = "#8fa899";
    hint.style.fontSize = "11px";
    hint.style.marginTop = "auto";
    hint.textContent = "Viewport: drag to orbit · scroll to zoom";
    panel.appendChild(hint);

    // Right viewport host.
    const viewport = document.createElement("div");
    viewport.style.position = "relative";
    this.viewport = viewport;

    root.appendChild(panel);
    root.appendChild(viewport);
    document.body.appendChild(root);
    this.root = root;

    this._bindPainting();
  }

  _row(label, control) {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "5px" });
    const span = document.createElement("span");
    span.textContent = label;
    span.style.color = "#8fa899";
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  _slider(label, min, max, value, step, onInput) {
    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.style.width = "100%";
    input.style.accentColor = "#7fdca0";
    const valSpan = document.createElement("span");
    valSpan.style.color = "#d7e6dc";
    valSpan.textContent = `${label}: ${value}`;
    input.addEventListener("input", () => {
      valSpan.textContent = `${label}: ${input.value}`;
      onInput(parseFloat(input.value));
    });
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { display: "flex", flexDirection: "column", gap: "5px" });
    wrap.appendChild(valSpan);
    wrap.appendChild(input);
    return wrap;
  }

  _fileInput() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.color = "#8fa899";
    input.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) this._loadImageFile(file);
    });
    return input;
  }

  _button(label, onClick) {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      cursor: "pointer",
      font: "inherit",
      fontSize: "11px",
      padding: "7px 11px",
      color: "#d7e6dc",
      background: "rgba(127,220,160,0.08)",
      border: "1px solid rgba(120,200,140,0.25)",
      borderRadius: "7px",
    });
    b.addEventListener("click", onClick);
    return b;
  }

  // --- source raster ----------------------------------------------------------

  _initSourceCanvas() {
    this.sctx = this.sourceCanvas.getContext("2d", { willReadFrequently: true });
    this._clearSource();
    // Seed with a soft blob so first open shows something.
    this._paintAt(SOURCE_RES * 0.5, SOURCE_RES * 0.5, 60, 0.9);
    this._paintAt(SOURCE_RES * 0.62, SOURCE_RES * 0.42, 36, 0.8);
  }

  _clearSource() {
    this.sctx.fillStyle = "#0d0d0d";
    this.sctx.fillRect(0, 0, SOURCE_RES, SOURCE_RES);
    this._scheduleGenerate();
  }

  _loadImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Cover-fit the image into the square source canvas.
      const scale = Math.max(SOURCE_RES / img.width, SOURCE_RES / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      this.sctx.fillStyle = "#000";
      this.sctx.fillRect(0, 0, SOURCE_RES, SOURCE_RES);
      this.sctx.drawImage(img, (SOURCE_RES - w) / 2, (SOURCE_RES - h) / 2, w, h);
      URL.revokeObjectURL(url);
      this._generate();
    };
    img.src = url;
  }

  _bindPainting() {
    const canvas = this.sourceCanvas;
    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * SOURCE_RES,
        y: ((e.clientY - r.top) / r.height) * SOURCE_RES,
      };
    };
    canvas.addEventListener("pointerdown", (e) => {
      this._painting = true;
      canvas.setPointerCapture(e.pointerId);
      const p = toLocal(e);
      this._lastPaint = p;
      this._paintAt(p.x, p.y, 18, 1);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this._painting) return;
      const p = toLocal(e);
      // Interpolate to avoid gaps when moving fast.
      if (this._lastPaint) {
        const steps = Math.ceil(Math.hypot(p.x - this._lastPaint.x, p.y - this._lastPaint.y) / 6);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          this._paintAt(
            this._lastPaint.x + (p.x - this._lastPaint.x) * t,
            this._lastPaint.y + (p.y - this._lastPaint.y) * t,
            18,
            1
          );
        }
      }
      this._lastPaint = p;
    });
    const end = () => {
      if (!this._painting) return;
      this._painting = false;
      this._lastPaint = null;
      this._generate();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  _paintAt(x, y, radius, strength) {
    const g = this.sctx.createRadialGradient(x, y, 0, x, y, radius);
    const a = strength;
    g.addColorStop(0, `rgba(190, 220, 150, ${a})`);
    g.addColorStop(1, "rgba(190, 220, 150, 0)");
    this.sctx.fillStyle = g;
    this.sctx.beginPath();
    this.sctx.arc(x, y, radius, 0, Math.PI * 2);
    this.sctx.fill();
  }

  _scheduleGenerate() {
    if (this.isOpen && this._three) this._generate();
    else this._needsGenerate = true;
  }

  // --- 3D ---------------------------------------------------------------------

  _initThree() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.viewport.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121815);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(30, 50, 20);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x2a3320, 0.9));

    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })
    );
    scene.add(mesh);

    // Minimal orbit controller (spherical around the origin).
    const orbit = { az: 0.7, pol: 1.0, dist: 38, target: new THREE.Vector3(0, 0, 0) };
    this._three = { renderer, scene, camera, mesh, orbit };
    this._bindOrbit();
    this._applyOrbit();
    this._generate();

    window.addEventListener("resize", () => {
      if (this.isOpen) this._resizeViewport();
    });
  }

  _bindOrbit() {
    const el = this._three.renderer.domElement;
    el.style.cursor = "grab";
    el.style.touchAction = "none";
    let dragging = false;
    let last = null;
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      last = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const o = this._three.orbit;
      o.az -= (e.clientX - last.x) * 0.008;
      o.pol = Math.min(Math.max(o.pol - (e.clientY - last.y) * 0.008, 0.15), Math.PI - 0.15);
      last = { x: e.clientX, y: e.clientY };
      this._applyOrbit();
    });
    const stop = () => {
      dragging = false;
      el.style.cursor = "grab";
    };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const o = this._three.orbit;
        o.dist = Math.min(Math.max(o.dist * (1 + Math.sign(e.deltaY) * 0.08), 10), 120);
        this._applyOrbit();
      },
      { passive: false }
    );
  }

  _applyOrbit() {
    const { camera, orbit } = this._three;
    const { az, pol, dist, target } = orbit;
    camera.position.set(
      target.x + dist * Math.sin(pol) * Math.sin(az),
      target.y + dist * Math.cos(pol),
      target.z + dist * Math.sin(pol) * Math.cos(az)
    );
    camera.lookAt(target);
  }

  _resizeViewport() {
    if (!this._three) return;
    const { renderer, camera } = this._three;
    const w = this.viewport.clientWidth || window.innerWidth - 300;
    const h = this.viewport.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // Build the relief geometry from the current source raster.
  _generate() {
    if (!this._three) {
      this._needsGenerate = true;
      return;
    }
    this._needsGenerate = false;

    const seg = this.segments;
    const img = this.sctx.getImageData(0, 0, SOURCE_RES, SOURCE_RES).data;

    // Precompute a luminance buffer, optionally box-blurred for smoothing.
    let lum = new Float32Array(SOURCE_RES * SOURCE_RES);
    for (let i = 0; i < SOURCE_RES * SOURCE_RES; i++) {
      const r = img[i * 4],
        g = img[i * 4 + 1],
        b = img[i * 4 + 2];
      let l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (this.invert) l = 1 - l;
      lum[i] = l;
    }
    for (let s = 0; s < this.smoothing; s++) lum = boxBlur(lum, SOURCE_RES);

    const plane = new THREE.PlaneGeometry(40, 40, seg, seg);
    plane.rotateX(-Math.PI / 2); // lie flat, displace up

    const pos = plane.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      // Plane spans [-20,20]; map to [0,1] then to source pixels.
      const u = (pos.getX(i) + 20) / 40;
      const v = 1 - (pos.getZ(i) + 20) / 40;
      const px = Math.min(SOURCE_RES - 1, Math.max(0, Math.round(u * (SOURCE_RES - 1))));
      const py = Math.min(SOURCE_RES - 1, Math.max(0, Math.round(v * (SOURCE_RES - 1))));
      const idx = py * SOURCE_RES + px;

      pos.setY(i, lum[idx] * this.heightScale);

      colors[i * 3 + 0] = srgbToLinear(img[idx * 4] / 255);
      colors[i * 3 + 1] = srgbToLinear(img[idx * 4 + 1] / 255);
      colors[i * 3 + 2] = srgbToLinear(img[idx * 4 + 2] / 255);
    }
    plane.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    plane.computeVertexNormals();

    const mesh = this._three.mesh;
    mesh.geometry.dispose();
    mesh.geometry = plane;
  }

  _startLoop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      const t = this._three;
      if (t) t.renderer.render(t.scene, t.camera);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}

// --- helpers ------------------------------------------------------------------

function boxBlur(src, size) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          sum += src[ny * size + nx];
          n++;
        }
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
