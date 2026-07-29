import { app } from "./firebase.js";
import {
  POLL,
  castVote,
  hasVoted,
  markVoted,
  votedFor,
  watchResults,
} from "./votes.js";

const status = document.getElementById("status");
const questionEl = document.getElementById("question");
const optionsEl = document.getElementById("options");

let counts = {};

function totalVotes() {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

function render() {
  const voted = hasVoted();
  const choice = votedFor();
  const total = totalVotes();

  optionsEl.replaceChildren(
    ...POLL.options.map((option) => {
      const count = counts[option.id] ?? 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;

      const li = document.createElement("li");
      li.className = "option" + (option.id === choice ? " chosen" : "");

      const button = document.createElement("button");
      button.textContent = option.label;
      button.disabled = voted;
      button.addEventListener("click", () => vote(option.id));

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = `${pct}%`;

      const tally = document.createElement("span");
      tally.className = "tally";
      tally.textContent = voted ? `${count} (${pct}%)` : "";

      li.append(button, bar, tally);
      return li;
    })
  );

  if (voted) {
    status.textContent = `Thanks for voting! ${total} vote${total === 1 ? "" : "s"} so far.`;
  } else {
    status.textContent = "Pick an option to cast your vote.";
  }
}

async function vote(optionId) {
  try {
    await castVote(optionId);
    markVoted(optionId);
    render();
  } catch (err) {
    console.error("Vote failed:", err);
    status.textContent = "Could not record your vote — please try again.";
  }
}

if (app) {
  questionEl.textContent = POLL.question;
  render();
  watchResults((next) => {
    counts = next;
    render();
  });
} else {
  status.textContent = "Failed to initialize Firebase.";
}
