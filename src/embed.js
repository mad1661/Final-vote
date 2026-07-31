import { app } from "./firebase.js";
import {
  DIVISIONS,
  DIVISION_NAMES,
  MAX_PICKS,
  alreadyVoted,
  castVotes,
  divisionCount,
  fetchBoardOnce,
  hasVoted,
  isValidEmail,
  loadDivisionAssets,
  markVoted,
  saveVoter,
  savedVoter,
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

const VERSION = "v13";
const detected = detectDivision();
const division = detected.division ?? (DEMO ? 1 : null);

// Inside an iframe, report our content height so the host page (using
// the snippet's resize script) can grow the iframe and scroll as one
// page instead of nesting a second scrollbar.
const widgetEl = document.querySelector(".widget");

// Real content height, whichever scrolling mode we're in.
function contentHeight() {
  return Math.max(widgetEl.scrollHeight, document.body.scrollHeight);
}

// Scroll back to the top of whatever is actually scrolling.
function scrollToTop() {
  if (document.documentElement.classList.contains("frame-scroll")) {
    widgetEl.scrollTop = 0;
  } else {
    window.scrollTo({ top: 0 });
  }
}

// The host page reports where the visitor's screen is over our content (see
// the snippet's script). A cross-origin frame can't work that out for
// itself, and without it the pick banner — which carries the Submit button —
// scrolls off with the rest of the page. With it, the banner rides along.
let hostTracking = false;

function trackHostView(view) {
  const banner = document.getElementById("pick-banner");
  if (!banner || banner.classList.contains("hidden")) return;
  hostTracking = true;
  document.documentElement.classList.remove("frame-scroll");
  const visibleStart = Math.max(0, -view.top);
  const natural = banner.offsetTop;
  const maxShift = Math.max(
    0,
    widgetEl.scrollHeight - banner.offsetHeight - natural - 16
  );
  const shift = Math.min(Math.max(visibleStart + 8 - natural, 0), maxShift);
  banner.style.transform = shift > 0 ? `translateY(${Math.round(shift)}px)` : "";
}

addEventListener("message", (e) => {
  const view = e.data?.legendVoteView;
  if (view && typeof view.top === "number") trackHostView(view);
});

try {
  if (window.self !== window.top) {
    const report = () => {
      const height = contentHeight();
      // Walk every ancestor, not just the immediate parent: site builders
      // often wrap an embed in their own frame, and the page holding the
      // resize script is then two levels up.
      let frame = window;
      for (let i = 0; i < 6 && frame !== window.top; i++) {
        frame = frame.parent;
        frame.postMessage({ legendVoteHeight: height }, "*");
      }
      // If the host never grows the frame — an embed pinned to a fixed
      // height, or one whose page dropped the resize script — everything
      // past that height is unreachable, and with scrolling="no" it can't
      // even be scrolled to. Give the widget its own scrollbar so the whole
      // ballot stays usable. Undone automatically if the frame does grow.
      // Not needed when the host reports our screen position: then the frame
      // grows, the page scrolls as one, and the banner tracks the screen.
      document.documentElement.classList.toggle(
        "frame-scroll",
        !hostTracking && widgetEl.scrollHeight > window.innerHeight + 40
      );
    };
    new ResizeObserver(report).observe(document.body);
    addEventListener("load", report);
    setInterval(report, 1500);
  }
} catch {
  // sandboxed parent — leave as-is
}

const status = document.getElementById("status");
const listEl = document.getElementById("list");
const divLine = document.getElementById("div-line");
const logoEl = document.getElementById("logo");
const submitBar = document.getElementById("submit-bar");
const submitBtn = document.getElementById("submit-btn");
const submitTop = document.getElementById("submit-top");
const overlay = document.getElementById("overlay");
const foot = document.getElementById("foot");
const photoStrip = document.getElementById("photo-strip");
const pickBanner = document.getElementById("pick-banner");
const pickCount = document.getElementById("pick-count");
const voterPage = document.getElementById("voter-page");
const picksList = document.getElementById("picks-list");
const voterName = document.getElementById("voter-name");
const voterEmail = document.getElementById("voter-email");
const voterError = document.getElementById("voter-error");
const voterSubmit = document.getElementById("voter-submit");
const voterBack = document.getElementById("voter-back");
foot.textContent = `Live results · ${VERSION} · ${DEMO ? "demo" : detected.source}`;

let board = { byDivision: {}, votes: new Map() };
let picks = new Set();
let submitted = false;

// Phone screenshots arrive as tall images with big black (or white)
// letterbox bars; a square crop shows mostly bar. Detect the real content
// bounds at thumbnail scale and swap in a trimmed copy of the photo.
function smartTrim(img) {
  try {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return;
    const w = 64, h = Math.max(8, Math.round((64 * nh) / nw));
    const probe = document.createElement("canvas");
    probe.width = w; probe.height = h;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const rowHas = new Array(h).fill(false);
    const colHas = new Array(w).fill(false);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum > 24 && lum < 240) {
          rowHas[y] = true;
          colHas[x] = true;
        }
      }
    }
    let top = rowHas.indexOf(true), bottom = rowHas.lastIndexOf(true);
    let left = colHas.indexOf(true), right = colHas.lastIndexOf(true);
    if (top < 0 || left < 0) return;
    const sy = Math.floor((top / h) * nh), ey = Math.ceil(((bottom + 1) / h) * nh);
    const sx = Math.floor((left / w) * nw), ex = Math.ceil(((right + 1) / w) * nw);
    const cw = ex - sx, ch = ey - sy;
    // only bother when the bars are a meaningful share of the image
    if (cw / nw > 0.94 && ch / nh > 0.94) return;
    const out = document.createElement("canvas");
    out.width = cw; out.height = ch;
    out.getContext("2d").drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      for (const el of img.parentElement?.querySelectorAll("img") ?? [img]) {
        el.src = url;
      }
    }, "image/jpeg", 0.92);
  } catch {
    // canvas tainted (no CORS on that host) or draw failure — leave as-is
  }
}

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

const bioPage = document.getElementById("bio-page");
let bioOpen = false;

function closeBio() {
  bioOpen = false;
  bioPage.classList.add("hidden");
  listEl.classList.remove("hidden");
  photoStrip.classList.remove("hidden");
  status.classList.remove("hidden");
  render();
  scrollToTop();
}

function backButton() {
  const b = document.createElement("button");
  b.className = "back-btn";
  b.textContent = "← Back to voting";
  b.addEventListener("click", closeBio);
  return b;
}

function showBio(entry) {
  bioOpen = true;
  const photos = entry.photos?.length ? entry.photos : entry.photoUrl ? [entry.photoUrl] : [];
  const parts = [backButton()];
  let main = null;
  if (photos[0]) {
    main = document.createElement("img");
    main.className = "main";
    main.src = photos[0];
    main.alt = entry.name;
    parts.push(main);
  }
  if (photos.length > 1) {
    const grid = document.createElement("div");
    grid.className = "photo-grid";
    for (const url of photos.slice(1, 9)) {
      const t = document.createElement("img");
      t.src = url;
      t.alt = entry.name;
      t.loading = "lazy";
      t.addEventListener("click", () => {
        const prev = main.src;
        main.src = url;
        t.src = prev;
      });
      grid.append(t);
    }
    parts.push(grid);
  }
  const h3 = document.createElement("h3");
  h3.textContent = entry.name;
  parts.push(h3);
  if (entry.category) {
    const cat = document.createElement("div");
    cat.className = "cat";
    cat.textContent = entry.category;
    parts.push(cat);
  }
  const p = document.createElement("p");
  p.className = "bio-text";
  p.textContent = entry.bio || "No bio yet.";
  parts.push(p);
  parts.push(backButton());

  bioPage.replaceChildren(...parts);
  listEl.classList.add("hidden");
  photoStrip.classList.add("hidden");
  status.classList.add("hidden");
  submitBar.classList.add("hidden");
  pickBanner.classList.add("hidden");
  bioPage.classList.remove("hidden");
  scrollToTop();
}

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

/* ---------- Confirm step: name + email, one ballot per person ---------- */

let voterOpen = false;

function nameFor(id) {
  return (board.byDivision[division] ?? []).find((e) => e.id === id)?.name ?? id;
}

function showVoterForm() {
  voterOpen = true;
  picksList.replaceChildren(
    ...[...picks].map((id) => {
      const li = document.createElement("li");
      li.textContent = nameFor(id);
      return li;
    })
  );
  const saved = savedVoter();
  if (!voterName.value) voterName.value = saved.name ?? "";
  if (!voterEmail.value) voterEmail.value = saved.email ?? "";
  voterError.classList.add("hidden");
  voterSubmit.disabled = false;
  voterSubmit.textContent = `Cast my ${picks.size} vote${picks.size === 1 ? "" : "s"}`;
  listEl.classList.add("hidden");
  photoStrip.classList.add("hidden");
  status.classList.add("hidden");
  submitBar.classList.add("hidden");
  pickBanner.classList.add("hidden");
  voterPage.classList.remove("hidden");
  scrollToTop();
  if (!voterName.value) voterName.focus();
}

function closeVoterForm() {
  voterOpen = false;
  voterPage.classList.add("hidden");
  listEl.classList.remove("hidden");
  photoStrip.classList.remove("hidden");
  status.classList.remove("hidden");
  render();
  scrollToTop();
}

function voterFormError(message) {
  voterError.textContent = message;
  voterError.classList.remove("hidden");
  voterSubmit.disabled = false;
  voterSubmit.textContent = "Try again";
}

voterBack.addEventListener("click", closeVoterForm);

voterSubmit.addEventListener("click", async () => {
  const name = voterName.value.trim();
  const email = voterEmail.value.trim();
  if (name.length < 2) {
    voterFormError("Please enter your name.");
    voterName.focus();
    return;
  }
  if (!isValidEmail(email)) {
    voterFormError("Please enter a valid email address.");
    voterEmail.focus();
    return;
  }
  voterSubmit.disabled = true;
  voterSubmit.textContent = "Submitting…";
  saveVoter({ name, email });

  if (DEMO) {
    for (const id of picks) {
      const perName = board.votes.get(id) ?? {};
      perName[division] = (perName[division] ?? 0) + 1;
      board.votes.set(id, perName);
    }
    submitted = true;
    closeVoterForm();
    return;
  }

  try {
    if (await alreadyVoted(email, division)) {
      voterFormError(
        `${email} has already voted in ${DIVISION_NAMES[division]}. Each person gets one ballot.`
      );
      return;
    }
    await castVotes([...picks], division, { name, email });
    markVoted(division, [...picks]);
    submitted = true;
    closeVoterForm();
  } catch (err) {
    console.error("Vote failed:", err);
    // A rejected write is either a second ballot from this address or
    // rules that aren't published yet — re-check so the voter is told
    // which one it is.
    if (err?.code === "permission-denied" && (await alreadyVoted(email, division))) {
      voterFormError(
        `${email} has already voted in ${DIVISION_NAMES[division]}. Each person gets one ballot.`
      );
    } else if (err?.code === "permission-denied") {
      voterFormError("Voting isn't open yet — please try again later.");
    } else {
      voterFormError("Could not record your votes — please try again.");
    }
  }
});

function render() {
  if (bioOpen || voterOpen) return;
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
          const bg = document.createElement("img");
          bg.className = "bg";
          bg.alt = "";
          bg.loading = "lazy";
          bg.src = entry.photoUrl;
          const img = document.createElement("img");
          img.className = "fg";
          img.crossOrigin = "anonymous";
          img.src = entry.photoUrl;
          img.alt = "";
          img.loading = "lazy";
          let trimmed = false;
          img.addEventListener("load", () => {
            if (!trimmed) {
              trimmed = true;
              smartTrim(img);
            }
          });
          img.addEventListener("error", () => {
            // retry once without CORS mode (hosts that lack CORS headers)
            if (img.crossOrigin) {
              img.crossOrigin = null;
              img.src = entry.photoUrl;
              return;
            }
            bg.remove();
            img.remove();
            avatar.textContent = initials(entry.name);
          });
          avatar.append(bg, img);
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
    pickBanner.classList.add("hidden");
    status.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = "Thanks for voting!";
    status.append(b, ` ${total} vote${total === 1 ? "" : "s"} cast — live results below.`);
  } else {
    submitBar.classList.remove("hidden");
    pickBanner.classList.remove("hidden");
    const n = picks.size;
    pickCount.textContent = `${n} of ${MAX_PICKS} selected`;
    status.textContent = "Tap names to select, then hit submit.";
    submitBtn.disabled = n === 0;
    submitBtn.textContent =
      n === 0 ? `Pick up to ${MAX_PICKS}` : `Submit ${n} vote${n === 1 ? "" : "s"}`;
    submitTop.disabled = n === 0;
    submitTop.textContent = n === 0 ? "Submit" : `Submit ${n}`;
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

for (const btn of [submitBtn, submitTop]) {
  btn.addEventListener("click", () => {
    if (picks.size === 0) return;
    showVoterForm();
  });
}

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
  // Main logo: the '51 Legends sponsor shield. The one uploaded in the vote
  // admin wins for every division; otherwise a file hosted alongside the
  // nomination app, then the 75th logo as a last resort. Each candidate
  // falls through to the next if it fails to load.
  const hostedLogos = [
    `/51-legends-d${division}.png`,
    `/51-legends.png`,
    `/nhra-75-logo.png`,
  ];
  function setLogo(urls) {
    const queue = urls.filter(Boolean);
    const next = () => {
      const url = queue.shift();
      if (url === undefined) {
        logoEl.onerror = null;
        return;
      }
      logoEl.src = url;
    };
    logoEl.onerror = next;
    next();
  }
  setLogo(hostedLogos);

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
      if (assets.logo51 || assets.logo75) {
        setLogo([assets.logo51, ...hostedLogos.slice(0, 2), assets.logo75, ...hostedLogos.slice(2)]);
      }
      if (assets.logo) badge.src = assets.logo;
    });
  }
  if (DEMO) {
    board = demoBoard();
    render();
  } else if (app) {
    render();
    let gotData = false;
    watchBoard(
      (next) => {
        gotData = true;
        board = next;
        render();
      },
      (where, err) => {
        status.textContent = `Data error loading ${where} — ${err?.code ?? "unknown"}. Check the Firestore rules.`;
      }
    );
    // The live listener holds a streaming connection open, and some mobile
    // browsers quietly refuse that inside a cross-site iframe: no data, no
    // error, just "Loading…" forever. If nothing has arrived shortly, read
    // the ballot once over ordinary requests instead. The listener still
    // wins if it wakes up later.
    setTimeout(async () => {
      if (gotData) return;
      try {
        const once = await fetchBoardOnce();
        if (gotData) return;
        board = once;
        render();
      } catch (err) {
        console.error("One-shot board fetch failed:", err);
        status.textContent = `Could not load the ballot — ${err?.code ?? "network error"}. Please refresh.`;
      }
    }, 5000);
  } else {
    status.textContent = "Failed to initialize.";
  }
}
