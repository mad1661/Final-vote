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
const division = Number(params.get("div"));
const hasDivision = DIVISIONS.includes(division);

const status = document.getElementById("status");
const subtitle = document.getElementById("subtitle");
const picker = document.getElementById("picker");
const boardEl = document.getElementById("board");
const divTag = document.getElementById("div-tag");
const searchEl = document.getElementById("search");
const listEl = document.getElementById("list");

let board = { byDivision: {}, votes: new Map() };
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
  const rows = (board.byDivision[division] ?? [])
    .map((entry) => ({
      ...entry,
      count: divisionCount(board.votes, entry.id, division),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q))
    : rows;

  if (visible.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      rows.length === 0
        ? "No candidates yet — check back soon."
        : "No names match your search.";
    listEl.replaceChildren(li);
  } else {
    listEl.replaceChildren(
      ...visible.map((entry) => {
        const rank = rows.indexOf(entry) + 1;
        const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className =
          "row" + (chosen ? " chosen" : "") + (rank <= 3 ? ` r${rank}` : "");

        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.width = `${pct}%`;

        const rankEl = document.createElement("span");
        rankEl.className = "rank";
        rankEl.textContent = String(rank);

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = voted
          ? `${entry.count} vote${entry.count === 1 ? "" : "s"} · ${pct}%`
          : "";

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(fill, rankEl, name, count, button);
        return li;
      })
    );
  }

  if (voted) {
    status.textContent = `Thanks for voting! ${total} vote${total === 1 ? "" : "s"} cast in Division ${division}.`;
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
  watchBoard((next) => {
    board = next;
    renderBoard();
  });
}
