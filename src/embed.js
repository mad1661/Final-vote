import { app } from "./firebase.js";
import {
  DIVISIONS,
  DIVISION_NAMES,
  MAX_PICKS,
  castVotes,
  divisionCount,
  hasVoted,
  loadDivisionAssets,
  markVoted,
  votedFor,
  watchBoard,
} from "./names.js";

const params = new URLSearchParams(location.search);

// Optional light theme for light-colored division sites: embed.html?theme=light
if (params.get("theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

// Demo mode renders sample legends without touching Firestore, so the
// widget can be previewed before any names are loaded: embed.html?demo=1
const DEMO = params.has("demo");

// Division resolution. The embedding site's domain is the source of truth
// (nhradiv1.com -> Division 1), so it outranks a ?div=N pinned in the
// snippet — a mispasted snippet self-corrects on a division domain.
function divisionFromHost(host) {
  const match = /div(?:ision)?[-_]?([1-7])(?![0-9])/i.exec(host ?? "");
  return match ? Number(match[1]) : null;
}

function detectDivision() {
  const origins = location.ancestorOrigins;
  if (origins) {
    for (let i = origins.length - 1; i >= 0; i--) {
      try {
        const host = new URL(origins[i]).hostname;
        const found = divisionFromHost(host);
        if (found) return { division: found, source: `site: ${host}` };
      } catch {
        // opaque/invalid origin — keep looking
      }
    }
  }
  try {
    const host = new URL(document.referrer).hostname;
    const found = divisionFromHost(host);
    if (found) return { division: found, source: `ref: ${host}` };
  } catch {
    // no or unparsable referrer — fall through
  }
  const fromParam = Number(params.get("div"));
  if (DIVISIONS.includes(fromParam)) {
    return { division: fromParam, source: "pinned in snippet" };
  }
  return { division: null, source: "no signal" };
}

const VERSION = "v6";
const detected = detectDivision();
const division = detected.division ?? (DEMO ? 1 : null);

const status = document.getElementById("status");
const listEl = document.getElementById("list");
const divLine = document.getElementById("div-line");
const logoEl = document.getElementById("logo");
const submitBar = document.getElementById("submit-bar");
const submitBtn = document.getElementById("submit-btn");
const overlay = document.getElementById("overlay");
const foot = document.getElementById("foot");
const photoStrip = document.getElementById("photo-strip");
foot.textContent = `Live results · ${VERSION} · ${DEMO ? "demo" : detected.source}`;

let board = { byDivision: {}, votes: new Map() };
let picks = new Set();
let submitted = false;

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function demoBoard() {
  const legends = [
    ["Don Garlits", "Driver — Top Fuel pioneer, 144 national event wins.", 214],
    ["Shirley Muldowney", "First woman licensed in Top Fuel; three-time champion.", 198],
    ["John Force", "16-time Funny Car world champion.", 171],
    ["Bob Glidden", "Pro Stock's winningest driver of his era.", 96],
    ["Kenny Bernstein", "First to break 300 mph.", 61],
    ["Warren Johnson", "The Professor of Pro Stock.", 44],
    ["Joe Amato", "Five-time Top Fuel champion.", 23],
  ];
  const names = legends.map(([name, bio], i) => ({
    id: `demo-${i}`,
    name,
    bio,
    photoUrl: "",
    category: "Driver",
  }));
  const byDivision = { [division]: names };
  const votes = new Map(
    legends.map(([, , count], i) => [`demo-${i}`, { [division]: count }])
  );
  return { byDivision, votes };
}

function showBio(entry) {
  const card = document.createElement("div");
  card.className = "bio-card";
  const photos = entry.photos?.length ? entry.photos : entry.photoUrl ? [entry.photoUrl] : [];
  if (photos[0]) {
    const img = document.createElement("img");
    img.src = photos[0];
    img.alt = entry.name;
    card.append(img);
  }
  if (photos.length > 1) {
    const grid = document.createElement("div");
    grid.className = "photo-grid";
    for (const url of photos.slice(1, 7)) {
      const t = document.createElement("img");
      t.src = url;
      t.alt = entry.name;
      t.loading = "lazy";
      t.addEventListener("click", () => {
        const main = card.querySelector("img");
        const prev = main.src;
        main.src = url;
        t.src = prev;
      });
      grid.append(t);
    }
    card.append(grid);
  }
  const h3 = document.createElement("h3");
  h3.textContent = entry.name;
  card.append(h3);
  if (entry.category) {
    const cat = document.createElement("div");
    cat.className = "cat";
    cat.textContent = entry.category;
    card.append(cat);
  }
  const p = document.createElement("p");
  p.textContent = entry.bio || "No bio yet.";
  card.append(p);
  const close = document.createElement("button");
  close.textContent = "Close";
  close.addEventListener("click", () => overlay.classList.add("hidden"));
  card.append(close);
  overlay.replaceChildren(card);
  overlay.classList.remove("hidden");
}
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) overlay.classList.add("hidden");
});

function renderPhotoStrip(rows) {
  const photos = [];
  for (const entry of rows) {
    for (const url of entry.photos?.length ? entry.photos : entry.photoUrl ? [entry.photoUrl] : []) {
      if (!photos.includes(url)) photos.push(url);
      if (photos.length >= 9) break;
    }
    if (photos.length >= 9) break;
  }
  const totalPhotos = rows.reduce(
    (sum, r) => sum + (r.photos?.length ?? (r.photoUrl ? 1 : 0)),
    0
  );
  photoStrip.replaceChildren(
    ...photos.map((url) => {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      return img;
    })
  );
  if (totalPhotos > photos.length) {
    const more = document.createElement("span");
    more.className = "more";
    more.textContent = `+${totalPhotos - photos.length} more`;
    photoStrip.append(more);
  }
}

function render() {
  const voted = submitted || (DEMO ? false : hasVoted(division));
  const mine = new Set(DEMO && submitted ? picks : votedFor(division));
  if (submitted) picks.forEach((p) => mine.add(p));

  let rows = (board.byDivision[division] ?? []).map((entry) => ({
    ...entry,
    count: divisionCount(board.votes, entry.id, division),
  }));
  rows = voted
    ? rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    : rows.sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  renderPhotoStrip(rows);

  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No candidates yet — check back soon.";
    listEl.replaceChildren(li);
  } else {
    listEl.replaceChildren(
      ...rows.map((entry, i) => {
        const rank = i + 1;
        const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
        const isMine = voted ? mine.has(entry.id) : picks.has(entry.id);

        const li = document.createElement("li");
        li.className =
          "row" +
          (isMine ? " picked" : "") +
          (voted && rank <= 3 ? ` r${rank}` : "");

        const fill = document.createElement("div");
        fill.className = "fill";
        if (voted) {
          requestAnimationFrame(() => {
            fill.style.width = `${pct}%`;
          });
        }
        li.append(fill);

        if (voted) {
          const medal = document.createElement("span");
          medal.className = "rank-medal";
          medal.textContent = String(rank);
          li.append(medal);
        }

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        if (entry.photoUrl) {
          const img = document.createElement("img");
          img.src = entry.photoUrl;
          img.alt = "";
          img.loading = "lazy";
          avatar.append(img);
        } else {
          avatar.textContent = initials(entry.name);
        }
        li.append(avatar);

        const info = document.createElement("div");
        info.className = "info";
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = entry.name;
        info.append(name);
        const meta = document.createElement("div");
        meta.className = "meta";
        const bits = [];
        if (entry.category) bits.push(entry.category);
        meta.textContent = bits.join(" · ");
        if (entry.bio || entry.photoUrl) {
          const bioLink = document.createElement("span");
          bioLink.className = "bio-link";
          bioLink.textContent = (bits.length ? " · " : "") + "View bio";
          bioLink.addEventListener("click", (e) => {
            e.stopPropagation();
            showBio(entry);
          });
          meta.append(bioLink);
        }
        info.append(meta);
        li.append(info);

        if (voted) {
          const count = document.createElement("span");
          count.className = "count";
          const b = document.createElement("b");
          b.textContent = String(entry.count);
          count.append(b, `${pct}%`);
          li.append(count);
        } else {
          const box = document.createElement("span");
          box.className = "pick-box";
          box.textContent = "✓";
          li.append(box);
          li.addEventListener("click", () => togglePick(entry.id));
        }

        return li;
      })
    );
  }

  if (voted) {
    submitBar.classList.add("hidden");
    status.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = "Thanks for voting!";
    status.append(b, ` ${total} vote${total === 1 ? "" : "s"} cast — live results below.`);
  } else {
    submitBar.classList.remove("hidden");
    const n = picks.size;
    status.textContent = `Pick your top ${MAX_PICKS} legends — ${n} of ${MAX_PICKS} selected.`;
    submitBtn.disabled = n === 0;
    submitBtn.textContent =
      n === 0 ? `Pick up to ${MAX_PICKS}` : `Submit ${n} vote${n === 1 ? "" : "s"}`;
  }
}

function togglePick(id) {
  if (picks.has(id)) {
    picks.delete(id);
  } else if (picks.size < MAX_PICKS) {
    picks.add(id);
  } else {
    status.textContent = `That's ${MAX_PICKS} already — tap a picked name to swap it.`;
    return;
  }
  render();
}

submitBtn.addEventListener("click", async () => {
  if (picks.size === 0) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";
  if (DEMO) {
    for (const id of picks) {
      const perName = board.votes.get(id) ?? {};
      perName[division] = (perName[division] ?? 0) + 1;
      board.votes.set(id, perName);
    }
    submitted = true;
    render();
    return;
  }
  try {
    await castVotes([...picks], division);
    markVoted(division, [...picks]);
    submitted = true;
    render();
  } catch (err) {
    console.error("Vote failed:", err);
    submitBtn.disabled = false;
    submitBtn.textContent = "Try again";
    status.textContent = "Could not record your votes — please try again.";
  }
});

function renderDivisionChooser() {
  divLine.textContent = "Choose your division";
  status.textContent = "";
  const li = document.createElement("li");
  li.className = "choose";
  for (const d of DIVISIONS) {
    const a = document.createElement("a");
    a.textContent = `D${d}`;
    const url = new URL(location.href);
    url.searchParams.set("div", String(d));
    a.href = url.toString();
    li.append(a);
  }
  listEl.replaceChildren(li);
}

if (!DIVISIONS.includes(division)) {
  renderDivisionChooser();
} else {
  divLine.textContent = `of the ${DIVISION_NAMES[division]}`;
  document.title = `'51 Legends — ${DIVISION_NAMES[division]}`;
  // Main logo: the '51 Legends sponsor shield. Tries the division-specific
  // file, then a shared one, then divisionAssets/75th logo fallbacks.
  let logoLocked = false;
  const logoFallbacks = [`/51-legends.png`, `/nhra-75-logo.png`];
  logoEl.onload = () => {
    logoLocked = !logoEl.src.endsWith("/nhra-75-logo.png");
  };
  logoEl.onerror = () => {
    const next = logoFallbacks.shift();
    if (next) logoEl.src = next;
    else logoEl.onerror = null;
  };
  logoEl.src = `/51-legends-d${division}.png`;

  // Division badge (D1..D7 images hosted alongside the nomination app),
  // preferring the small variant and falling back to the full-size one.
  const badge = document.getElementById("div-badge");
  badge.src = `/D${division}-small.png`;
  badge.onerror = () => {
    badge.onerror = null;
    badge.src = `/D${division}.PNG`;
    badge.onerror = () => (badge.style.display = "none");
  };
  badge.onload = () => (badge.style.display = "block");
  if (!DEMO) {
    loadDivisionAssets(division).then((assets) => {
      if (assets.logo75 && !logoLocked) logoEl.src = assets.logo75;
      if (assets.logo) badge.src = assets.logo;
    });
  }
  if (DEMO) {
    board = demoBoard();
    render();
  } else if (app) {
    render();
    watchBoard(
      (next) => {
        board = next;
        render();
      },
      (where, err) => {
        status.textContent = `Data error loading ${where} — ${err?.code ?? "unknown"}. Check the Firestore rules.`;
      }
    );
  } else {
    status.textContent = "Failed to initialize.";
  }
}
