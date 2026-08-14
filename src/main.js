import { app } from "./firebase.js";
import {
  DIVISIONS,
  hasVoted,
  markVoted,
  voteFor,
  votedFor,
  watchNames,
} from "./names.js";

const params = new URLSearchParams(location.search);
const division = Number(params.get("div"));
const hasDivision = DIVISIONS.includes(division);

const status = document.getElementById("status");
const subtitle = document.getElementById("subtitle");
const picker = document.getElementById("picker");
const boardEl = document.getElementById("board");
const divTag = document.getElementById("div-tag");
const searchEl = document.getElementById("search");
const listEl = document.getElementById("list");

let names = [];
let query = "";

function renderPicker() {
  picker.classList.remove("hidden");
  picker.replaceChildren(
    ...DIVISIONS.map((d) => {
      const a = document.createElement("a");
      a.className = "division-card";
      a.href = `?div=${d}`;
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = `D${d}`;
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = `Division ${d}`;
      a.append(num, lbl);
      return a;
    })
  );
}

function renderBoard() {
  const voted = hasVoted(division);
  const choice = votedFor(division);

  const q = query.trim().toLowerCase();
  const visible = q
    ? names.filter((r) => r.name.toLowerCase().includes(q))
    : names;

  if (visible.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      names.length === 0
        ? "No candidates yet — check back soon."
        : "No names match your search.";
    listEl.replaceChildren(li);
  } else {
    listEl.replaceChildren(
      ...visible.map((entry) => {
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className = "row" + (chosen ? " chosen" : "");

        // Decorative accent bar — same look for every row; conveys no
        // vote information (tallies are admin-only).
        const fill = document.createElement("div");
        fill.className = "fill";

        const rankEl = document.createElement("span");
        rankEl.className = "rank";
        rankEl.textContent = String(names.indexOf(entry) + 1);

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(fill, rankEl, name, button);
        return li;
      })
    );
  }

  if (voted) {
    status.textContent = `Thanks for voting! Your Division ${division} vote has been recorded.`;
  } else {
    status.textContent = "Pick one name — this is the final vote.";
  }
}

async function vote(id) {
  try {
    await voteFor(id, division);
    markVoted(division, id);
    renderBoard();
  } catch (err) {
    console.error("Vote failed:", err);
    status.textContent = "Could not record your vote — please try again.";
  }
}

if (!app) {
  status.textContent = "Failed to initialize.";
} else if (!hasDivision) {
  renderPicker();
} else {
  subtitle.textContent = "Cast your vote for your division's legend.";
  divTag.textContent = `Division ${division}`;
  document.title = `Legend Vote — Division ${division}`;
  boardEl.classList.remove("hidden");
  searchEl.addEventListener("input", () => {
    query = searchEl.value;
    renderBoard();
  });
  renderBoard();
  watchNames((next) => {
    names = next;
    renderBoard();
  });
}
