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

const status = document.getElementById("status");
const listEl = document.getElementById("list");
const divTag = document.getElementById("div-tag");

let board = { names: [], votes: new Map() };

function render() {
  const voted = hasVoted(division);
  const choice = votedFor(division);
  const rows = board.names
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
      ...rows.map((entry) => {
        const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className = "row" + (chosen ? " chosen" : "");

        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.width = `${pct}%`;

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.name;

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = voted ? `${entry.count} · ${pct}%` : "";

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(fill, name, count, button);
        return li;
      })
    );
  }

  if (voted) {
    status.textContent = `Thanks for voting! ${total} vote${total === 1 ? "" : "s"} cast in Division ${division}.`;
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

if (!DIVISIONS.includes(division)) {
  divTag.textContent = "Invalid division";
  status.textContent =
    "This embed needs a division number, e.g. embed.html?div=3";
} else if (app) {
  divTag.textContent = `Division ${division}`;
  document.title = `Legend Vote — Division ${division}`;
  render();
  watchBoard((next) => {
    board = next;
    render();
  });
} else {
  status.textContent = "Failed to initialize.";
}
