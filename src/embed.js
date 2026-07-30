import { app } from "./firebase.js";
import {
  DIVISIONS,
  divisionCount,
  hasVoted,
  markVoted,
  voteFor,
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
// Priority:
// 1. any ancestor frame's origin (covers site builders like Wix that nest
//    embeds in intermediate frames; Chromium/Safari)
// 2. document.referrer hostname (Firefox fallback)
// 3. explicit ?div=N (for sites whose domain names no division)
function divisionFromHost(host) {
  const match = /div(?:ision)?[-_]?([1-7])(?![0-9])/i.exec(host ?? "");
  return match ? Number(match[1]) : null;
}

function detectDivision() {
  const origins = location.ancestorOrigins;
  if (origins) {
    // Walk outward; the top-most ancestor is the real site domain.
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

const VERSION = "v4";
const detected = detectDivision();
const division = detected.division ?? (DEMO ? 1 : null);

const status = document.getElementById("status");
const listEl = document.getElementById("list");
const divTag = document.getElementById("div-tag");
const foot = document.getElementById("foot");
foot.textContent = `Live results · One vote per person · ${VERSION} · ${DEMO ? "demo" : detected.source}`;

let board = { byDivision: {}, votes: new Map() };
let demoChoice = null;

function demoBoard() {
  const names = [
    "Don Garlits",
    "Shirley Muldowney",
    "John Force",
    "Bob Glidden",
    "Kenny Bernstein",
    "Warren Johnson",
    "Joe Amato",
  ].map((name, i) => ({ id: `demo-${i}`, name }));
  const byDivision = {};
  byDivision[division] = names;
  const votes = new Map([
    ["demo-0", { [division]: 214 }],
    ["demo-1", { [division]: 198 }],
    ["demo-2", { [division]: 171 }],
    ["demo-3", { [division]: 96 }],
    ["demo-4", { [division]: 61 }],
    ["demo-5", { [division]: 44 }],
    ["demo-6", { [division]: 23 }],
  ]);
  return { byDivision, votes };
}

function render() {
  const voted = DEMO ? demoChoice !== null : hasVoted(division);
  const choice = DEMO ? demoChoice : votedFor(division);
  const rows = (board.byDivision[division] ?? [])
    .map((entry) => ({
      ...entry,
      count: divisionCount(board.votes, entry.id, division),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = rows.reduce((sum, r) => sum + r.count, 0);

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
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className =
          "row" + (chosen ? " chosen" : "") + (rank <= 3 ? ` r${rank}` : "");

        const fill = document.createElement("div");
        fill.className = "fill";
        requestAnimationFrame(() => {
          fill.style.width = `${pct}%`;
        });

        const rankEl = document.createElement("span");
        rankEl.className = "rank";
        rankEl.textContent = String(rank);

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;

        const count = document.createElement("span");
        count.className = "count";
        if (voted) {
          const b = document.createElement("b");
          b.textContent = String(entry.count);
          count.append(b, `${pct}%`);
        }

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "✓ Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(fill, rankEl, name, count, button);
        return li;
      })
    );
  }

  if (voted) {
    status.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = "Thanks for voting!";
    status.append(
      b,
      ` ${total} vote${total === 1 ? "" : "s"} cast in Division ${division} — results are live.`
    );
  } else {
    status.textContent = "Vote for your division's legend — one pick per person.";
  }
}

async function vote(id) {
  if (DEMO) {
    demoChoice = id;
    const perName = board.votes.get(id) ?? {};
    perName[division] = (perName[division] ?? 0) + 1;
    board.votes.set(id, perName);
    render();
    return;
  }
  try {
    await voteFor(id, division);
    markVoted(division, id);
    render();
  } catch (err) {
    console.error("Vote failed:", err);
    status.textContent = "Could not record your vote — please try again.";
  }
}

function renderDivisionChooser() {
  divTag.textContent = "Vote";
  status.textContent = "Choose your division:";
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
  // Referrer was missing or didn't identify a division site — let the
  // visitor pick, so the widget still works anywhere.
  renderDivisionChooser();
} else {
  divTag.textContent = `Division ${division}`;
  document.title = `Legend Vote — Division ${division}`;
  if (DEMO) {
    board = demoBoard();
    render();
  } else if (app) {
    render();
    watchBoard((next) => {
      board = next;
      render();
    });
  } else {
    status.textContent = "Failed to initialize.";
  }
}
