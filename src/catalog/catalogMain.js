// Slice Select-1 — the catalog page entry. A thin, self-contained player front door: it renders one card per
// curated playable slice (from the registry-adjacent metadata) and launches the chosen slice by navigating to
// its play URL. No 3D engine, no runtime import — just the metadata + vanilla DOM, so the menu is cheap and
// fully isolated from the editor/runtime boot (the editor stays the default landing).

import { listPlayableSlices } from "../world/samples/playableSlices.js";

// The play URL a card launches: the existing `?play=1&world=<id>` runtime path. main.js recognises a playable
// `world` id and gives it a per-slice save slot, so each slice's completion/reward stays isolated.
const playHref = (id) => `/?play=1&world=${encodeURIComponent(id)}`;

// Presentation-only: a per-slice accent tied to each slice's readability identity (kept OUT of the pure metadata
// module). Falls back to the glacial accent for any future slice without a mapping.
const ACCENT = {
  "visual-benchmark-1": "#8fe6b0", // The Relic Overlook — open & bright
  "ice-chapel-1": "#7fb6e6", // The Ice Chapel — enclosed & cold
  "frost-causeway-1": "#cfd9e2", // The Frost Causeway — pale whiteout
};

function renderCard(slice) {
  const card = document.createElement("a");
  card.className = "slice-card";
  card.href = playHref(slice.id);
  card.dataset.world = slice.id;
  card.style.setProperty("--card-accent", ACCENT[slice.id] ?? "var(--accent)");
  card.setAttribute("aria-label", `Play ${slice.title}`);

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = slice.title;

  const chips = document.createElement("div");
  chips.className = "chips";
  const readability = document.createElement("span");
  readability.className = "chip readability";
  readability.textContent = slice.readability;
  const difficulty = document.createElement("span");
  difficulty.className = "chip difficulty";
  difficulty.textContent = slice.difficulty;
  chips.append(readability, difficulty);

  const desc = document.createElement("p");
  desc.className = "card-desc";
  desc.textContent = slice.description;

  const objective = document.createElement("p");
  objective.className = "card-objective";
  objective.textContent = slice.objective;

  body.append(title, chips, desc, objective);

  const cta = document.createElement("span");
  cta.className = "card-cta";
  cta.textContent = "▶ Play";

  card.append(body, cta);
  return card;
}

function renderCatalog(root) {
  const slices = listPlayableSlices();
  root.replaceChildren();
  if (slices.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No playable slices are registered.";
    root.append(empty);
    return slices;
  }
  for (const slice of slices) root.append(renderCard(slice));
  return slices;
}

const root = document.getElementById("catalog");
const rendered = renderCatalog(root);

// DEV hook for the browser proof: enumerate the rendered cards (id + title). Stripped from production.
if (import.meta.env.DEV) {
  window.__SLICE_CATALOG__ = () => ({
    cards: Array.from(document.querySelectorAll(".slice-card")).map((el) => ({
      id: el.dataset.world,
      title: el.querySelector(".card-title")?.textContent ?? "",
      href: el.getAttribute("href"),
    })),
    count: rendered.length,
  });
}
