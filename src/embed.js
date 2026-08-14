import { app } from "./firebase.js";
import {
  DIVISIONS,
  hasVoted,
  markVoted,
  voteFor,
  votedFor,
  watchNames,
} from "./names.js";

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
  const fromParam = Number(new URLSearchParams(location.search).get("div"));
  if (DIVISIONS.includes(fromParam)) {
    return { division: fromParam, source: "pinned in snippet" };
  }
  return { division: null, source: "no signal" };
}

const VERSION = "v4";
const detected = detectDivision();
const division = detected.division;

const status = document.getElementById("status");
const listEl = document.getElementById("list");
const divTag = document.getElementById("div-tag");
const foot = document.getElementById("foot");
foot.textContent = `One vote per person · ${VERSION} · ${detected.source}`;

let names = [];

function render() {
  const voted = hasVoted(division);
  const choice = votedFor(division);

  if (names.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No candidates yet — check back soon.";
    listEl.replaceChildren(li);
  } else {
    listEl.replaceChildren(
      ...names.map((entry) => {
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className = "row" + (chosen ? " chosen" : "");

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(name, button);
        return li;
      })
    );
  }

  if (voted) {
    status.textContent = `Thanks for voting! Your Division ${division} vote has been recorded.`;
  } else {
    status.textContent = "Cast your vote — one pick per person.";
  }
}

async function vote(id) {
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
  divTag.textContent = "Select division";
  status.textContent = "Choose your division to vote:";
  const li = document.createElement("li");
  li.style.display = "flex";
  li.style.flexWrap = "wrap";
  li.style.gap = "0.4rem";
  li.style.listStyle = "none";
  for (const d of DIVISIONS) {
    const a = document.createElement("a");
    a.className = "vote-btn";
    a.style.textDecoration = "none";
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
} else if (app) {
  divTag.textContent = `Division ${division}`;
  document.title = `Legend Vote — Division ${division}`;
  render();
  watchNames((next) => {
    names = next;
    render();
  });
} else {
  status.textContent = "Failed to initialize.";
}
