import { app } from "./firebase.js";
import {
  addName,
  hasVoted,
  markVoted,
  slugify,
  voteFor,
  votedFor,
  watchNames,
} from "./names.js";

const status = document.getElementById("status");
const listEl = document.getElementById("names");
const searchEl = document.getElementById("search");
const form = document.getElementById("add-name-form");
const input = document.getElementById("name-input");
const statNames = document.getElementById("stat-names");
const statVotes = document.getElementById("stat-votes");
const statLeader = document.getElementById("stat-leader");

let names = [];
let query = "";

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function render() {
  const voted = hasVoted();
  const choice = votedFor();
  const total = names.reduce((sum, n) => sum + n.votes, 0);
  const leader = names[0];

  statNames.textContent = String(names.length);
  statVotes.textContent = String(total);
  statLeader.textContent = leader && leader.votes > 0 ? leader.name : "—";

  const q = query.trim().toLowerCase();
  const visible = q
    ? names.filter((entry) => entry.name.toLowerCase().includes(q))
    : names;

  if (visible.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      names.length === 0
        ? "No names yet — suggest the first one below."
        : "No names match your search.";
    listEl.replaceChildren(li);
  } else {
    listEl.replaceChildren(
      ...visible.map((entry) => {
        const rank = names.indexOf(entry) + 1;
        const pct = total > 0 ? Math.round((entry.votes / total) * 100) : 0;
        const chosen = entry.id === choice;

        const li = document.createElement("li");
        li.className = "card" + (chosen ? " chosen" : "");

        const rankEl = document.createElement("span");
        rankEl.className = "rank" + (rank <= 3 ? ` r${rank}` : "");
        rankEl.textContent = String(rank);

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = initials(entry.name);

        const info = document.createElement("div");
        info.className = "info";
        const nameEl = document.createElement("div");
        nameEl.className = "name";
        nameEl.textContent = entry.name;
        const meter = document.createElement("div");
        meter.className = "meter";
        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = `${pct}%`;
        meter.append(bar);
        const tally = document.createElement("div");
        tally.className = "tally";
        tally.textContent = `${entry.votes} vote${entry.votes === 1 ? "" : "s"} · ${pct}%`;
        info.append(nameEl, meter, tally);

        const button = document.createElement("button");
        button.className = "vote-btn";
        button.textContent = chosen ? "Voted" : "Vote";
        button.disabled = voted;
        button.addEventListener("click", () => vote(entry.id));

        li.append(rankEl, avatar, info, button);
        if (chosen) {
          const badge = document.createElement("span");
          badge.className = "your-pick";
          badge.textContent = "Your pick";
          li.append(badge);
        }
        return li;
      })
    );
  }

  if (names.length === 0) {
    status.textContent = "";
  } else if (voted) {
    status.textContent = `Thanks for voting! ${total} vote${total === 1 ? "" : "s"} cast so far — results update live.`;
  } else {
    status.textContent = "This is the final vote — pick one name.";
  }
}

async function vote(id) {
  try {
    await voteFor(id);
    markVoted(id);
    render();
  } catch (err) {
    console.error("Vote failed:", err);
    status.textContent = "Could not record your vote — please try again.";
  }
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = input.value.trim();
  if (!name) return;
  if (names.some((entry) => slugify(entry.name) === slugify(name))) {
    status.textContent = `"${name}" is already on the board.`;
    input.value = "";
    return;
  }
  try {
    await addName(name);
    input.value = "";
    input.focus();
  } catch (err) {
    console.error("Adding name failed:", err);
    status.textContent = "Could not add that name — please try again.";
  }
});

if (app) {
  render();
  watchNames((next) => {
    names = next;
    render();
  });
} else {
  status.textContent = "Failed to initialize Firebase.";
}
