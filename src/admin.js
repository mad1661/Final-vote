import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
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
  addNominations,
  clearCollection,
  divisionCount,
  getNominations,
  loadDivisionAssets,
  mergeCandidates,
  reassignNomination,
  removeName,
  restoreFromSubmissions,
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
        union.set(entry.id, { ...entry, memberships: [d] });
      } else {
        existing.memberships.push(d);
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

/* ---------- Duplicate detection ---------- */

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

function looksSimilar(a, b) {
  const ta = a.id.split("-").filter(Boolean);
  const tb = b.id.split("-").filter(Boolean);
  if (levenshtein(a.id, b.id) <= 2) return true;
  // one name contained in the other ("don-garlits" in "big-daddy-don-garlits")
  const setA = new Set(ta), setB = new Set(tb);
  if (ta.every((t) => setB.has(t)) || tb.every((t) => setA.has(t))) return true;
  // same last name, similar first name
  const lastA = ta[ta.length - 1], lastB = tb[tb.length - 1];
  if (lastA && lastA === lastB && ta[0] && tb[0]) {
    if (ta[0][0] === tb[0][0] || levenshtein(ta[0], tb[0]) <= 1) return true;
  }
  return false;
}

// Dismissals are stored per PAIR, so pulling one name out of a group
// leaves the rest of the group flagged.
const DISMISSED_PAIRS_KEY = "dupes-dismissed-pairs";
function dismissedPairs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_PAIRS_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function pairKey(a, b) {
  return [a, b].sort().join("|");
}
function dismissPairs(pairs) {
  const set = dismissedPairs();
  for (const [a, b] of pairs) set.add(pairKey(a, b));
  localStorage.setItem(DISMISSED_PAIRS_KEY, JSON.stringify([...set]));
}

function findDuplicateGroups(entries) {
  const parent = new Map(entries.map((e) => [e.id, e.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const dismissed = dismissedPairs();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (dismissed.has(pairKey(entries[i].id, entries[j].id))) continue;
      if (looksSimilar(entries[i], entries[j])) {
        parent.set(find(entries[i].id), find(entries[j].id));
      }
    }
  }
  const groups = new Map();
  for (const e of entries) {
    const root = find(e.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

const viewOverlay = document.getElementById("view-overlay");
viewOverlay.addEventListener("click", (e) => {
  if (e.target === viewOverlay) viewOverlay.classList.add("hidden");
});

function showCandidate(entry) {
  const card = document.createElement("div");
  card.className = "editor";
  const photos = entry.photos?.length
    ? entry.photos
    : entry.photoUrl
      ? [entry.photoUrl]
      : [];
  if (photos[0]) {
    const img = document.createElement("img");
    img.src = photos[0];
    img.style.cssText =
      "width:100%;max-height:16rem;object-fit:contain;background:rgba(0,0,0,.4);border-radius:12px;margin-bottom:.6rem";
    card.append(img);
    if (photos.length > 1) {
      const grid = document.createElement("div");
      grid.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(4rem,1fr));gap:.4rem;margin-bottom:.6rem";
      for (const url of photos.slice(1, 9)) {
        const t = document.createElement("img");
        t.src = url;
        t.style.cssText =
          "width:100%;height:4rem;object-fit:cover;border-radius:8px;cursor:pointer";
        t.addEventListener("click", () => {
          const prev = img.src;
          img.src = url;
          t.src = prev;
        });
        grid.append(t);
      }
      card.append(grid);
    }
  }
  const h3 = document.createElement("h3");
  h3.textContent = entry.name;
  card.append(h3);
  const meta = document.createElement("p");
  meta.className = "hint";
  meta.textContent = [
    entry.category,
    entry.memberships.map((d) => `D${d}`).join(" "),
    `${entry.nominationDocIds.length} nomination${entry.nominationDocIds.length === 1 ? "" : "s"}`,
    `${totalCount(board.votes, entry.id)} votes`,
  ].filter(Boolean).join(" · ");
  card.append(meta);
  const bio = document.createElement("p");
  bio.style.cssText =
    "font-family:var(--font-serif);line-height:1.5;color:var(--text-2);white-space:pre-wrap";
  bio.textContent = entry.bio || "No bio submitted.";
  card.append(bio);
  const close = document.createElement("button");
  close.className = "btn small";
  close.textContent = "Close";
  close.addEventListener("click", () => viewOverlay.classList.add("hidden"));
  card.append(close);
  viewOverlay.replaceChildren(card);
  viewOverlay.classList.remove("hidden");
}

function renderDupes() {
  const section = document.getElementById("dupes-section");
  const list = document.getElementById("dupes-list");
  const union = unionCandidates();
  const groups = findDuplicateGroups([...union.values()]);
  section.classList.remove("hidden");
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent =
      "No possible duplicates detected right now. New nominations are checked automatically.";
    const reset = document.createElement("button");
    reset.className = "btn secondary small";
    reset.textContent = "Re-check cleared names";
    reset.addEventListener("click", () => {
      localStorage.removeItem(DISMISSED_PAIRS_KEY);
      renderDupes();
    });
    list.replaceChildren(empty, reset);
    return;
  }
  list.replaceChildren(
    ...groups.map((group) => {
      const box = document.createElement("div");
      box.className = "dupe-group";
      for (const entry of group) {
        const row = document.createElement("div");
        row.className = "dupe-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.dataset.id = entry.id;
        cb.style.cssText = "width:1.05rem;height:1.05rem;accent-color:var(--accent);cursor:pointer;flex-shrink:0";
        row.append(cb);
        const thumb = document.createElement("span");
        thumb.className = "thumb";
        thumb.style.cssText =
          "width:2.2rem;height:2.2rem;border-radius:9px;overflow:hidden;background:var(--surface-3);display:grid;place-items:center;flex-shrink:0;font-size:0.7rem;font-weight:700;color:var(--text-3)";
        if (entry.photoUrl) {
          const img = document.createElement("img");
          img.src = entry.photoUrl;
          img.style.cssText = "width:100%;height:100%;object-fit:cover";
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
        extra.textContent = [
          entry.memberships.map((d) => `D${d}`).join(" "),
          `${entry.nominationDocIds.length} nomination${entry.nominationDocIds.length === 1 ? "" : "s"}`,
          `${totalCount(board.votes, entry.id)} votes`,
        ].join(" · ");
        who.append(nm, extra);
        const view = document.createElement("button");
        view.className = "btn secondary small";
        view.textContent = "View";
        view.addEventListener("click", () => showCandidate(entry));
        const keep = document.createElement("button");
        keep.className = "btn small";
        keep.textContent = "Keep this one";
        keep.addEventListener("click", async () => {
          const ticked = [...box.querySelectorAll("input[type=checkbox]:checked")]
            .map((c) => c.dataset.id)
            .filter((id) => id !== entry.id);
          const others = ticked.length
            ? group.filter((e) => ticked.includes(e.id))
            : group.filter((e) => e.id !== entry.id);
          if (others.length === 0) {
            alert("Tick the box on at least one other entry to merge into this one.");
            return;
          }
          const scopeNote = ticked.length ? "the TICKED entries" : "ALL entries in this group";
          if (!confirm(`Keep "${entry.name}" and merge ${scopeNote}: ${others.map((o) => `"${o.name}"`).join(", ")} into it?`)) return;
          try {
            await mergeCandidates(entry, others, board.votes);
          } catch (err) {
            console.error("Merge failed:", err);
            alert("Merge failed — check your admin access and try again.");
          }
        });
        const notDupe = document.createElement("button");
        notDupe.className = "btn secondary small";
        notDupe.textContent = "Not a duplicate";
        notDupe.title = "Remove just this name from the group";
        notDupe.addEventListener("click", () => {
          dismissPairs(
            group.filter((e) => e.id !== entry.id).map((e) => [entry.id, e.id])
          );
          renderDupes();
        });
        row.append(thumb, who, view, notDupe, keep);
        box.append(row);
      }
      const actions = document.createElement("div");
      actions.className = "dupe-actions";
      const dismiss = document.createElement("button");
      dismiss.className = "btn secondary small";
      dismiss.textContent = "None are duplicates";
      dismiss.addEventListener("click", () => {
        const pairs = [];
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            pairs.push([group[i].id, group[j].id]);
          }
        }
        dismissPairs(pairs);
        renderDupes();
      });
      actions.append(dismiss);
      box.append(actions);
      return box;
    })
  );
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
  const filter = Number(document.getElementById("division-filter")?.value ?? 0);
  const rows = [...union.values()]
    .filter((entry) => filter === 0 || entry.memberships.includes(filter))
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
      bits.push(entry.memberships.map((d) => `D${d}`).join(" "));
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
        td.textContent = entry.memberships.includes(d) ? String(n) : "—";
        if (!entry.memberships.includes(d)) td.style.opacity = "0.35";
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

function originalNameHint(nom) {
  // the uploaded photo's filename preserves the name as submitted
  const m = /_(.+)\.[A-Za-z0-9]+$/.exec(nom.photoPath ?? "");
  return m ? m[1].replaceAll("_", " ") : "";
}

async function renderEditorNoms(entry) {
  const box = document.getElementById("editor-noms");
  box.textContent = "Loading nominations…";
  const noms = await getNominations(entry.nominationDocIds);
  if (noms.length === 0) {
    box.textContent = "No nomination records (admin-added name).";
    return;
  }
  box.replaceChildren(
    ...noms.map((nom) => {
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "align-items:center;background:rgba(0,0,0,0.3);border-radius:9px;padding:0.45rem 0.55rem;margin-top:0.4rem";
      if (nom.photoUrl) {
        const img = document.createElement("img");
        img.src = nom.photoUrl;
        img.style.cssText = "width:2rem;height:2rem;object-fit:cover;border-radius:6px";
        row.append(img);
      }
      const info = document.createElement("span");
      info.style.cssText = "flex:1;min-width:0;font-size:0.78rem;color:var(--text-3)";
      const hint = originalNameHint(nom);
      info.textContent = [
        `D${nom.division}`,
        nom.nominatorName || "anonymous",
        hint && hint.toLowerCase() !== (nom.nomineeName ?? "").toLowerCase()
          ? `submitted as: ${hint}`
          : "",
      ].filter(Boolean).join(" · ");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Move to name…";
      input.value = "";
      input.style.cssText = "width:11rem;padding:0.35rem 0.5rem;border:none;border-radius:7px;background:rgba(0,0,0,0.45);color:var(--text)";
      const move = document.createElement("button");
      move.className = "btn secondary small";
      move.textContent = "Move";
      move.addEventListener("click", async () => {
        const to = input.value.trim();
        if (!to) return;
        if (!confirm(`Move this nomination to "${to}"? They become (or join) their own candidate.`)) return;
        try {
          await reassignNomination(nom.id, to);
          row.remove();
        } catch (err) {
          console.error("Move failed:", err);
          alert("Move failed — check your admin access.");
        }
      });
      row.append(info, input, move);
      return row;
    })
  );
}

function openEditor(entry) {
  editingId = entry.id;
  editorTitle.textContent = `Edit — ${entry.name}`;
  editorName.value = entry.name;
  editorBio.value = entry.bio ?? "";
  editorPhotoUrl.value = entry.photoUrl ?? "";
  editorStatus.textContent = "";
  updatePreview();
  editorOverlay.classList.remove("hidden");
  renderEditorNoms(entry).catch((err) => {
    console.error("Nomination load failed:", err);
    document.getElementById("editor-noms").textContent = "Could not load nominations.";
  });
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

/* ---------- Start fresh ---------- */

const freshStatus = document.getElementById("fresh-status");

document.getElementById("restore-noms").addEventListener("click", async () => {
  if (!confirm("Restore every nomination's name to what was originally submitted? This undoes merges and moves for nominations that have photos.")) return;
  freshStatus.textContent = "Restoring…";
  try {
    const n = await restoreFromSubmissions();
    freshStatus.textContent = `Done — ${n} nomination${n === 1 ? "" : "s"} restored to the submitted name. Duplicates will reappear in the finder above.`;
  } catch (err) {
    console.error("Restore failed:", err);
    freshStatus.textContent = "Restore failed — check your admin access.";
  }
});

document.getElementById("clear-names").addEventListener("click", async () => {
  if (!confirm("Delete ALL admin-added names, bios, and photo overrides? Nominations are not touched.")) return;
  freshStatus.textContent = "Clearing…";
  try {
    const n = await clearCollection("names");
    freshStatus.textContent = `Done — ${n} admin name record${n === 1 ? "" : "s"} cleared.`;
  } catch (err) {
    console.error("Clear failed:", err);
    freshStatus.textContent = "Clear failed — check your admin access.";
  }
});

document.getElementById("clear-votes").addEventListener("click", async () => {
  if (!confirm("Reset ALL votes in ALL divisions to zero? This cannot be undone.")) return;
  if (!confirm("Are you sure? Every vote cast so far will be permanently deleted.")) return;
  freshStatus.textContent = "Resetting votes…";
  try {
    const n = await clearCollection("votes");
    freshStatus.textContent = `Done — ${n} vote tallies deleted. Everyone starts at zero.`;
  } catch (err) {
    console.error("Vote reset failed:", err);
    freshStatus.textContent = "Vote reset failed — check your admin access.";
  }
});

/* ---------- Export ---------- */

document.getElementById("export-csv").addEventListener("click", () => {
  const union = unionCandidates();
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["Name", "Category", ...DIVISIONS.map((d) => `D${d} votes`), "Total votes", "Nominations", "Divisions"].map(esc).join(","),
  ];
  const rows = [...union.values()].sort(
    (a, b) => totalCount(board.votes, b.id) - totalCount(board.votes, a.id)
  );
  for (const entry of rows) {
    lines.push(
      [
        entry.name,
        entry.category,
        ...DIVISIONS.map((d) => divisionCount(board.votes, entry.id, d)),
        totalCount(board.votes, entry.id),
        entry.nominationDocIds.length,
        entry.memberships.join(" "),
      ].map(esc).join(",")
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `legend-vote-results-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
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
    "width:100%;height:800px;border:0;border-radius:16px;background:#000";

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

// Header-name matching for the structured nomination sheet.
const SHEET_COLUMNS = {
  nomineeName: "nominee name",
  category: "category",
  yearsActive: "years active",
  reason: "reason",
  nominatorName: "nominator name",
  nominatorEmail: "nominator email",
  division: "division",
  divisionName: "division name",
  photoUrl: "photo url",
  submitted: "submitted",
};

function parseStructuredSheet(workbook) {
  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
    });
    if (!grid.length) continue;
    const headers = grid[0].map((c) => String(c ?? "").trim().toLowerCase());
    if (!headers.includes(SHEET_COLUMNS.nomineeName)) continue;
    const idx = {};
    for (const [key, label] of Object.entries(SHEET_COLUMNS)) {
      idx[key] = headers.indexOf(label);
    }
    for (const row of grid.slice(1)) {
      const entry = {};
      for (const [key, i] of Object.entries(idx)) {
        entry[key] = i >= 0 ? row[i] : "";
      }
      // fall back to the dropdown when a row has no division of its own
      if (!Number(entry.division)) {
        entry.division = Number(bulkDivision.value) || 0;
      }
      if (String(entry.nomineeName ?? "").trim()) rows.push(entry);
    }
  }
  return rows;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const workbook = XLSX.read(await file.arrayBuffer());

    // Structured nomination sheet (Nominee Name / Category / Reason / …)
    const structured = parseStructuredSheet(workbook);
    if (structured.length) {
      const divisions = [...new Set(structured.map((r) => Number(r.division)).filter(Boolean))];
      bulkStatus.textContent = `Importing ${structured.length} nomination${structured.length === 1 ? "" : "s"}…`;
      const added = await addNominations(structured);
      const skipped = structured.length - added;
      bulkStatus.textContent =
        `Done — ${added} nomination${added === 1 ? "" : "s"} imported from ${file.name}` +
        ` (division${divisions.length === 1 ? "" : "s"} ${divisions.join(", ") || "?"})` +
        (skipped ? `; ${skipped} row${skipped === 1 ? "" : "s"} skipped (no valid division — pick one in the dropdown and re-upload)` : "") +
        ". Re-uploading the same sheet updates instead of duplicating.";
      return;
    }

    // Plain list of names — original behavior
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

const authError = document.getElementById("auth-error");

document.getElementById("sign-in").addEventListener("click", async () => {
  authError.textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error("Google sign-in failed:", err);
    if (
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/popup-closed-by-user" ||
      err?.code === "auth/cancelled-popup-request"
    ) {
      // popup blockers: fall back to full-page redirect flow
      try {
        await signInWithRedirect(auth, new GoogleAuthProvider());
        return;
      } catch (err2) {
        console.error("Redirect sign-in failed:", err2);
      }
    }
    authError.textContent = `Google sign-in failed (${err?.code ?? "unknown"}).`;
  }
});

document.getElementById("sign-in-email").addEventListener("click", async () => {
  authError.textContent = "";
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) {
    authError.textContent = "Enter your email and password.";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("Email sign-in failed:", err);
    const msgs = {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/user-not-found": "No account with that email — add it in Firebase Authentication → Users.",
      "auth/operation-not-allowed": "Email/password sign-in isn't enabled in Firebase Authentication yet.",
      "auth/too-many-requests": "Too many attempts — wait a minute and try again.",
    };
    authError.textContent = msgs[err?.code] ?? `Sign-in failed (${err?.code ?? "unknown"}).`;
  }
});
document.getElementById("auth-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("sign-in-email").click();
});

document.getElementById("sign-out").addEventListener("click", () => signOut(auth));
document.getElementById("division-filter").addEventListener("change", renderNames);

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
      renderDupes();
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
