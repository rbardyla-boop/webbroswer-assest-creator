import * as THREE from "three";

// Request a reversed-Z depth buffer by default. Reverse-Z spreads floating-point
// depth precision evenly across the view distance instead of crowding it near the
// camera, which is what makes far outdoor geometry safe from z-fighting before we
// push voxel/procedural scale. It is OFF unless both requested and supported.
const REVERSE_DEPTH_DEFAULT = true;

// Creates and tunes the main WebGL renderer. Pixel ratio is capped so the
// grass field stays smooth on high-DPI displays.
export function createRenderer(container, { reverseDepth = REVERSE_DEPTH_DEFAULT } = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    stencil: false,
    // r0.169 spelling is `reverseDepthBuffer` (a CONSTRUCTOR parameter; the later
    // `reversedDepthBuffer` property does not exist in this version). Three gates
    // it on the EXT_clip_control extension internally — on a GPU/driver without
    // the extension the renderer transparently uses normal depth, and
    // `capabilities.reverseDepthBuffer` reports which path is active. Three also
    // handles the reverse-Z depth clear (0 not 1), depth func (GREATER), the
    // USE_REVERSEDEPTHBUF shader define, and shadow handling. Kept independent of
    // logarithmicDepthBuffer (left off) — the two are mutually exclusive features.
    reverseDepthBuffer: reverseDepth === true,
  });
  // Remember what we asked for so status reporting can distinguish
  // "unsupported" (requested but inactive) from "disabled" (never requested).
  // A distinct underscore prop (not `userData`, which is an Object3D convention
  // WebGLRenderer doesn't use) avoids any name-collision ambiguity.
  renderer._reverseDepthRequested = reverseDepth === true;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}

// Pure status logic, split out so it can be unit-tested without a GL context.
// `active` is the only thing that affects rendering; the rest is for reporting.
export function summarizeReverseDepth({ requested, extensionAvailable } = {}) {
  const req = requested === true;
  const ext = extensionAvailable === true;
  const active = req && ext;
  return {
    requested: req,
    extensionAvailable: ext,
    active,
    mode: active ? "reverse-z" : "normal-z",
  };
}

// Read the live renderer's reverse-Z status. `capabilities.reverseDepthBuffer` is
// three's own resolved truth (requested AND extension present); we cross-read the
// extension so the report can explain WHY it is inactive.
export function getReverseDepthStatus(renderer) {
  const requested = renderer?._reverseDepthRequested === true;
  const extensionAvailable = !!renderer?.extensions?.has?.("EXT_clip_control");
  const status = summarizeReverseDepth({ requested, extensionAvailable });
  // Trust three's resolved capability for `active` (it is the value that drives
  // the pipeline); summarize agrees, but capabilities is the authority.
  status.active = renderer?.capabilities?.reverseDepthBuffer === true;
  status.mode = status.active ? "reverse-z" : "normal-z";
  return status;
}
