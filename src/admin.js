import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import * as XLSX from "xlsx";
import { app } from "./firebase.js";
import {
  DIVISIONS,
  addNames,
  divisionCount,
  removeName,
  totalCount,
  watchBoard,
} from "./names.js";

const auth = getAuth(app);

const status = document.getElementById("status");
const authSection = document.getElementById("auth-section");
const adminUi = document.getElementById("admin-ui");
const signedInAs = document.getElementById("signed-in-as");
const bulkInput = document.getElementById("bulk-input");
const bulkStatus = document.getElementById("bulk-status");
const fileInput = document.getElementById("file-input");
const headRow = document.getElementById("head-row");
const namesBody = document.getElementById("names-body");
const countLine = document.getElementById("count-line");
const snippetsEl = document.getElementById("snippets");

let board = { names: [], votes: new Map() };
let stopWatching = null;

function renderHead() {
  headRow.replaceChildren(
    ...["Name", ...DIVISIONS.map((d) => `D${d}`), "Total", ""].map(
      (label, i) => {
        const th = document.createElement("th");
        th.textContent = label;
        if (i > 0 && i <= DIVISIONS.length + 1) th.className = "num";
        return th;
      }
    )
  );
}

function renderNames() {
  const rows = board.names
    .map((entry) => ({
      ...entry,
      total: totalCount(board.votes, entry.id),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  countLine.textContent = `${rows.length} name${rows.length === 1 ? "" : "s"}, ${grandTotal} vote${grandTotal === 1 ? "" : "s"} across all divisions.`;

  namesBody.replaceChildren(
    ...rows.map((entry) => {
      const tr = document.createElement("tr");

      const nameTd = document.createElement("td");
      nameTd.textContent = entry.name;
      tr.append(nameTd);

      for (const d of DIVISIONS) {
        const td = document.createElement("td");
        td.className = "num";
        const n = divisionCount(board.votes, entry.id, d);
        td.textContent = n ? String(n) : "·";
        tr.append(td);
      }

      const totalTd = document.createElement("td");
      totalTd.className = "num total";
      totalTd.textContent = String(entry.total);
      tr.append(totalTd);

      const actionTd = document.createElement("td");
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        if (!confirm(`Remove "${entry.name}" and its votes in all divisions?`))
          return;
        try {
          await removeName(entry.id);
        } catch (err) {
          console.error("Remove failed:", err);
          alert("Could not remove that name — check your access and try again.");
        }
      });
      actionTd.append(del);
      tr.append(actionTd);

      return tr;
    })
  );
}

function renderSnippets() {
  const base = `${location.origin}/embed.html`;
  snippetsEl.replaceChildren(
    ...DIVISIONS.map((d) => {
      const row = document.createElement("div");
      row.className = "snippet";

      const code = document.createElement("code");
      const html = `<iframe src="${base}?div=${d}" title="Legend Vote — Division ${d}" style="width:100%;max-width:560px;height:640px;border:0;border-radius:16px;background:#0d0d13"></iframe>`;
      code.textContent = html;

      const copy = document.createElement("button");
      copy.className = "btn secondary";
      copy.textContent = `Copy D${d}`;
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(html);
          copy.textContent = "Copied!";
        } catch {
          copy.textContent = "Select & copy";
        }
        setTimeout(() => (copy.textContent = `Copy D${d}`), 1500);
      });

      row.append(code, copy);
      return row;
    })
  );
}

async function bulkAdd(labels, sourceLabel) {
  const cleaned = labels.map((l) => String(l ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    bulkStatus.textContent = `No names found in ${sourceLabel}.`;
    return;
  }
  bulkStatus.textContent = `Adding ${cleaned.length} name${cleaned.length === 1 ? "" : "s"}…`;
  try {
    const added = await addNames(cleaned);
    bulkStatus.textContent = `Done — ${added} unique name${added === 1 ? "" : "s"} added/updated from ${sourceLabel}.`;
  } catch (err) {
    console.error("Bulk add failed:", err);
    bulkStatus.textContent =
      "Adding failed — make sure you're signed in with the admin account and the security rules allow it.";
  }
}

document.getElementById("add-pasted").addEventListener("click", () => {
  const labels = bulkInput.value.split(/[\n,;]+/);
  bulkAdd(labels, "the pasted list").then(() => {
    bulkInput.value = "";
  });
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const workbook = XLSX.read(await file.arrayBuffer());
    const labels = [];
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        blankrows: false,
      });
      for (const row of rows) {
        for (const cell of row) {
          if (typeof cell === "string" && cell.trim()) labels.push(cell);
          else if (typeof cell === "number") labels.push(String(cell));
        }
      }
    }
    await bulkAdd(labels, file.name);
  } catch (err) {
    console.error("File parse failed:", err);
    bulkStatus.textContent = `Could not read ${file.name} — is it a valid Excel or CSV file?`;
  } finally {
    fileInput.value = "";
  }
});

document.getElementById("sign-in").addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error("Sign-in failed:", err);
    status.textContent =
      "Sign-in failed. Make sure Google sign-in is enabled in Firebase Authentication.";
  }
});

document.getElementById("sign-out").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    status.textContent = "";
    signedInAs.textContent = `Signed in as ${user.email}`;
    authSection.classList.add("hidden");
    adminUi.classList.remove("hidden");
    renderHead();
    renderSnippets();
    stopWatching?.();
    stopWatching = watchBoard((next) => {
      board = next;
      renderNames();
    });
  } else {
    status.textContent = "Sign in to manage the vote.";
    authSection.classList.remove("hidden");
    adminUi.classList.add("hidden");
    stopWatching?.();
    stopWatching = null;
    board = { names: [], votes: new Map() };
  }
});
