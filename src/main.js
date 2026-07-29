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
const form = document.getElementById("add-name-form");
const input = document.getElementById("name-input");

let names = [];

function render() {
  const voted = hasVoted();
  const choice = votedFor();
  const total = names.reduce((sum, n) => sum + n.votes, 0);
  const leader = names[0];

  listEl.replaceChildren(
    ...names.map((entry) => {
      const pct = total > 0 ? Math.round((entry.votes / total) * 100) : 0;

      const li = document.createElement("li");
      li.className =
        "option" +
        (entry.id === choice ? " chosen" : "") +
        (leader && entry.id === leader.id && entry.votes > 0 ? " leading" : "");

      const button = document.createElement("button");
      button.textContent = entry.name;
      button.disabled = voted;
      button.addEventListener("click", () => vote(entry.id));

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${pct}%`;

      const tally = document.createElement("span");
      tally.className = "tally";
      tally.textContent = `${entry.votes} vote${entry.votes === 1 ? "" : "s"} (${pct}%)`;

      li.append(button, bar, tally);
      return li;
    })
  );

  if (names.length === 0) {
    status.textContent = "No names yet — add the first one below.";
  } else if (voted) {
    status.textContent = `Thanks for voting! ${total} vote${total === 1 ? "" : "s"} cast.`;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = input.value.trim();
  if (!name) return;
  if (names.some((entry) => slugify(entry.name) === slugify(name))) {
    status.textContent = `"${name}" is already on the list.`;
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
