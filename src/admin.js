import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";
import * as XLSX from "xlsx";
import { app } from "./firebase.js";
import {
  DIVISIONS,
  addNames,
  divisionCount,
  loadDivisionAssets,
  mergeCandidates,
  removeName,
  saveName,
  totalCount,
  watchBoard,
} from "./names.js";

const auth = getAuth(app);
const storage = getStorage(app);

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
const statNames = document.getElementById("stat-names");
const statNoms = document.getElementById("stat-noms");
const statVotes = document.getElementById("stat-votes");
const logoEl = document.getElementById("logo");

const editorOverlay = document.getElementById("editor-overlay");
const editorTitle = document.getElementById("editor-title");
const editorPreview = document.getElementById("editor-preview");
const editorName = document.getElementById("editor-name");
const editorBio = document.getElementById("editor-bio");
const editorPhotoUrl = document.getElementById("editor-photo-url");
const editorPhotoFile = document.getElementById("editor-photo-file");
const editorStatus = document.getElementById("editor-status");

let board = { byDivision: {}, votes: new Map() };
let stopWatching = null;
let editingId = null;
const selected = new Set();
const mergeBar = document.getElementById("merge-bar");
const bulkDivision = document.getElementById("bulk-division");

loadDivisionAssets("default").then((assets) => {
  if (assets.logo75) logoEl.src = assets.logo75;
});

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function unionCandidates() {
  const union = new Map();
  for (const d of DIVISIONS) {
    for (const entry of board.byDivision[d] ?? []) {
      const existing = union.get(entry.id);
      if (!existing) {
        union.set(entry.id, { ...entry });
      } else {
        if (!existing.photoUrl && entry.photoUrl) existing.photoUrl = entry.photoUrl;
        if (!existing.bio && entry.bio) existing.bio = entry.bio;
        for (const docId of entry.nominationDocIds) {
          if (!existing.nominationDocIds.includes(docId)) {
            existing.nominationDocIds.push(docId);
          }
        }
      }
    }
  }
  return union;
}

function renderHead() {
  headRow.replaceChildren(
    ...["", "Candidate", ...DIVISIONS.map((d) => `D${d}`), "Total", ""].map(
      (label, i) => {
        const th = document.createElement("th");
        th.textContent = label;
        if (i === 0) th.className = "sel";
        else if (i > 1 && i <= DIVISIONS.length + 2) th.className = "num";
        return th;
      }
    )
  );
}

function renderNames() {
  const union = unionCandidates();
  const rows = [...union.values()]
    .map((entry) => ({ ...entry, total: totalCount(board.votes, entry.id) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const nomCount = rows.reduce((sum, r) => sum + r.nominationDocIds.length, 0);

  statNames.textContent = String(rows.length);
  statNoms.textContent = String(nomCount);
  statVotes.textContent = String(grandTotal);
  countLine.textContent = `Sorted by total votes. Click Edit to add a bio or photo.`;

  namesBody.replaceChildren(
    ...rows.map((entry) => {
      const tr = document.createElement("tr");

      const selTd = document.createElement("td");
      selTd.className = "sel";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(entry.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(entry.id);
        else selected.delete(entry.id);
        mergeBar.classList.toggle("hidden", selected.size < 2);
      });
      selTd.append(cb);
      tr.append(selTd);

      const nameTd = document.createElement("td");
      const cand = document.createElement("div");
      cand.className = "cand";
      const thumb = document.createElement("span");
      thumb.className = "thumb";
      if (entry.photoUrl) {
        const img = document.createElement("img");
        img.src = entry.photoUrl;
        img.alt = "";
        img.loading = "lazy";
        thumb.append(img);
      } else {
        thumb.textContent = initials(entry.name);
      }
      const who = document.createElement("div");
      who.className = "who";
      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = entry.name;
      const extra = document.createElement("div");
      extra.className = "extra";
      const bits = [];
      if (entry.category) bits.push(entry.category);
      if (entry.nominationDocIds.length) {
        bits.push(`${entry.nominationDocIds.length} nomination${entry.nominationDocIds.length === 1 ? "" : "s"}`);
      }
      if (entry.bio) bits.push("bio ✓");
      extra.textContent = bits.join(" · ");
      who.append(nm, extra);
      cand.append(thumb, who);
      nameTd.append(cand);
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
      const edit = document.createElement("button");
      edit.className = "btn secondary small";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openEditor(entry));
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "Remove";
      del.style.marginLeft = "0.4rem";
      del.addEventListener("click", async () => {
        if (!confirm(`Remove "${entry.name}" everywhere (votes and nominations included)?`)) return;
        try {
          await removeName(entry.id, entry.nominationDocIds);
        } catch (err) {
          console.error("Remove failed:", err);
          alert("Could not remove that name — check your access and try again.");
        }
      });
      actionTd.append(edit, del);
      tr.append(actionTd);

      return tr;
    })
  );
}

/* ---------- Merge ---------- */

document.getElementById("merge-btn").addEventListener("click", async () => {
  const union = unionCandidates();
  const chosen = [...selected].map((id) => union.get(id)).filter(Boolean);
  if (chosen.length < 2) return;
  const listing = chosen.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  const answer = prompt(
    `Merging ${chosen.length} candidates into one.\n${listing}\n\nEnter the number of the name to KEEP:`,
    "1"
  );
  if (answer === null) return;
  const idx = Number(answer) - 1;
  const primary = chosen[idx];
  if (!primary) {
    alert("Not a valid number — merge cancelled.");
    return;
  }
  const duplicates = chosen.filter((c) => c.id !== primary.id);
  if (!confirm(`Keep "${primary.name}" and fold in ${duplicates.map((d) => `"${d.name}"`).join(", ")}? Their votes and nominations move to "${primary.name}".`)) return;
  try {
    await mergeCandidates(primary, duplicates, board.votes);
    selected.clear();
    mergeBar.classList.add("hidden");
  } catch (err) {
    console.error("Merge failed:", err);
    alert("Merge failed — check your admin access and try again.");
  }
});

/* ---------- Editor ---------- */

function openEditor(entry) {
  editingId = entry.id;
  editorTitle.textContent = `Edit — ${entry.name}`;
  editorName.value = entry.name;
  editorBio.value = entry.bio ?? "";
  editorPhotoUrl.value = entry.photoUrl ?? "";
  editorStatus.textContent = "";
  updatePreview();
  editorOverlay.classList.remove("hidden");
}

function updatePreview() {
  const url = editorPhotoUrl.value.trim();
  editorPreview.src = url;
  editorPreview.style.display = url ? "block" : "none";
}
editorPhotoUrl.addEventListener("input", updatePreview);

editorPhotoFile.addEventListener("change", async () => {
  const file = editorPhotoFile.files?.[0];
  if (!file || !editingId) return;
  editorStatus.textContent = "Uploading photo…";
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const ref = storageRef(storage, `candidates/${editingId}.${ext}`);
    const snap = await uploadBytes(ref, file);
    editorPhotoUrl.value = await getDownloadURL(snap.ref);
    updatePreview();
    editorStatus.textContent = "Photo uploaded — click Save to apply.";
  } catch (err) {
    console.error("Upload failed:", err);
    editorStatus.textContent =
      "Upload failed — check Storage rules allow the admin to write.";
  } finally {
    editorPhotoFile.value = "";
  }
});

document.getElementById("editor-cancel").addEventListener("click", () => {
  editorOverlay.classList.add("hidden");
  editingId = null;
});
editorOverlay.addEventListener("click", (e) => {
  if (e.target === editorOverlay) editorOverlay.classList.add("hidden");
});

document.getElementById("editor-save").addEventListener("click", async () => {
  if (!editingId) return;
  editorStatus.textContent = "Saving…";
  try {
    await saveName(editingId, {
      name: editorName.value.trim() || undefined,
      bio: editorBio.value.trim(),
      photoUrl: editorPhotoUrl.value.trim(),
    });
    editorOverlay.classList.add("hidden");
    editingId = null;
  } catch (err) {
    console.error("Save failed:", err);
    editorStatus.textContent =
      "Save failed — make sure you're the admin in the security rules.";
  }
});

/* ---------- Iframe creator ---------- */

function snippetRow(html, label) {
  const row = document.createElement("div");
  row.className = "snippet";
  const code = document.createElement("code");
  code.textContent = html;
  const copy = document.createElement("button");
  copy.className = "btn secondary small";
  copy.textContent = label;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(html);
      copy.textContent = "Copied!";
    } catch {
      copy.textContent = "Select & copy";
    }
    setTimeout(() => (copy.textContent = label), 1500);
  });
  row.append(code, copy);
  return row;
}

function renderSnippets() {
  const base = `${location.origin}/embed.html`;
  const style =
    "width:100%;max-width:560px;height:760px;border:0;border-radius:16px;background:#000";

  const universalNote = document.createElement("p");
  universalNote.className = "hint";
  universalNote.textContent =
    "One snippet for every division site — the widget reads the site's domain (nhradiv1.com → Division 1, …) and shows that division's ballot automatically. Add ?theme=light for light-colored sites.";

  const overrideNote = document.createElement("p");
  overrideNote.className = "hint";
  overrideNote.textContent =
    "If a site's domain doesn't contain its division number, use its pinned snippet instead:";

  snippetsEl.replaceChildren(
    universalNote,
    snippetRow(
      `<iframe src="${base}" title="'51 Legends Vote" style="${style}"></iframe>`,
      "Copy universal"
    ),
    overrideNote,
    ...DIVISIONS.map((d) =>
      snippetRow(
        `<iframe src="${base}?div=${d}" title="'51 Legends Vote — Division ${d}" style="${style}"></iframe>`,
        `Copy D${d}`
      )
    )
  );
}

/* ---------- Bulk add ---------- */

async function bulkAdd(labels, sourceLabel) {
  const cleaned = labels.map((l) => String(l ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    bulkStatus.textContent = `No names found in ${sourceLabel}.`;
    return;
  }
  bulkStatus.textContent = `Adding ${cleaned.length} name${cleaned.length === 1 ? "" : "s"}…`;
  try {
    const added = await addNames(cleaned, Number(bulkDivision.value));
    const scope = Number(bulkDivision.value) === 0 ? "all divisions" : `Division ${bulkDivision.value} only`;
    bulkStatus.textContent = `Done — ${added} unique name${added === 1 ? "" : "s"} added/updated from ${sourceLabel} (${scope}).`;
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

/* ---------- Auth ---------- */

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
    board = { byDivision: {}, votes: new Map() };
  }
});
