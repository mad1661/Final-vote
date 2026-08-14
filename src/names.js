import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase.js";

// Each visitor votes for their top picks (up to MAX_PICKS) per division.
export const MAX_PICKS = 5;

export const DIVISIONS = [1, 2, 3, 4, 5, 6, 7];

export const DIVISION_NAMES = {
  1: "Northeast Division",
  2: "Southeast Division",
  3: "North Central Division",
  4: "South Central Division",
  5: "West Central Division",
  6: "Northwest Division",
  7: "Pacific Division",
};

// Candidates come from two sources, deduped by name slug:
//  - `nominations` (the 75 Most Influential submission app): each doc has
//    nomineeName + division ('1'..'7'), so those names are per-division
//  - `names` (admin bulk adds): shared across every division
// Each division tallies separately in `votes` as doc id `d{division}_{slug}`.
export const NAMES_COLLECTION = "names";

const NAMES = collection(db, NAMES_COLLECTION);
const NOMINATIONS = collection(db, "nominations");
const VOTES = collection(db, "votes");
// Who voted: `voters` holds the name/email (admin-only reading), `voted`
// holds a PII-free marker the widget can check before submitting. Both are
// create-only, so a second ballot for the same email is rejected by the
// rules — and because the tallies are written in the same batch, the whole
// ballot fails with it.
const VOTERS = collection(db, "voters");
const VOTED = collection(db, "voted");

export function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Existing docs may store the name text under different keys, or only as
// the document id.
const NAME_FIELDS = ["name", "Name", "value", "text", "title", "label"];

function displayName(id, data) {
  for (const field of NAME_FIELDS) {
    if (typeof data[field] === "string" && data[field].trim()) {
      return data[field].trim();
    }
  }
  return id;
}

export async function addName(name) {
  const label = name.trim();
  const id = slugify(label);
  if (!id) throw new Error("Name is empty");
  await setDoc(
    doc(NAMES, id),
    { name: label, createdAt: serverTimestamp() },
    { merge: true }
  );
  return id;
}

// Bulk-add names (admin). Chunked to stay under Firestore's 500-write
// batch limit; slug keying means duplicates merge instead of multiplying.
export async function addNames(labels, division = 0) {
  const entries = [];
  const seen = new Set();
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    const id = slugify(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, label });
  }
  for (let i = 0; i < entries.length; i += 450) {
    const batch = writeBatch(db);
    for (const { id, label } of entries.slice(i, i + 450)) {
      batch.set(
        doc(NAMES, id),
        { name: label, division, createdAt: serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return entries.length;
}

// Admin: fold duplicate candidates into one. Combines each duplicate's
// division tallies into the primary, re-points its nomination docs to the
// primary name (so slug dedupe absorbs them), and deletes the leftovers.
export async function mergeCandidates(primary, duplicates, votes) {
  const batch = writeBatch(db);
  for (const dup of duplicates) {
    if (dup.id === primary.id) continue;
    const perName = votes.get(dup.id) ?? {};
    for (const d of DIVISIONS) {
      const n = perName[d] ?? 0;
      if (n > 0) {
        batch.set(
          doc(VOTES, `d${d}_${primary.id}`),
          {
            count: increment(n),
            division: d,
            nameId: primary.id,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      batch.delete(doc(VOTES, `d${d}_${dup.id}`));
    }
    for (const nomId of dup.nominationDocIds ?? []) {
      batch.update(doc(NOMINATIONS, nomId), { nomineeName: primary.name });
    }
    batch.delete(doc(NAMES, dup.id));
  }
  await batch.commit();
}

// Remove a candidate everywhere (admin): the admin-added name doc, its
// tallies in every division, and any nomination docs for the same person.
export async function removeName(id, nominationDocIds = []) {
  await deleteDoc(doc(NAMES, id));
  const targets = [
    ...DIVISIONS.map((division) => doc(VOTES, `d${division}_${id}`)),
    ...nominationDocIds.map((docId) => doc(NOMINATIONS, docId)),
  ];
  // Chunked: a heavily nominated candidate can carry more deletes than the
  // 500-write batch limit allows.
  for (let i = 0; i < targets.length; i += 450) {
    const batch = writeBatch(db);
    for (const ref of targets.slice(i, i + 450)) batch.delete(ref);
    await batch.commit();
  }
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(email ?? "").trim());
}

// Normalize an address so one inbox is one ballot: Gmail ignores dots and
// anything after a `+`, so `m.ark+vote@gmail.com` is the same person as
// `mark@gmail.com` and must not get a second vote.
export function normalizeEmail(email) {
  const clean = String(email ?? "").trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 1) return "";
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.split("+")[0].replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

// The voter id stored in Firestore is a hash, so the public marker
// collection never exposes anyone's address.
async function hashEmail(normalized) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(`legend-vote:${normalized}`);
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }
  let h = 0x811c9dc5; // FNV-1a, for the rare insecure context
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f${h.toString(16)}`;
}

export async function voterId(email, division) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  return `d${division}_${await hashEmail(normalized)}`;
}

// Has this address already voted in this division? Checked before writing
// so a repeat voter gets a clear message instead of a rules error.
export async function alreadyVoted(email, division) {
  const id = await voterId(email, division);
  if (!id) return false;
  try {
    return (await getDoc(doc(VOTED, id))).exists();
  } catch {
    return false; // marker unreadable — the write itself still enforces it
  }
}

// Cast one ballot: the voter's record, the public one-per-email marker, and
// +1 for each picked name — one atomic batch, so either the whole ballot
// lands or none of it does.
export async function castVotes(ids, division, voter = {}) {
  const picks = ids.slice(0, MAX_PICKS);
  const name = String(voter.name ?? "").trim();
  const email = String(voter.email ?? "").trim();
  if (picks.length === 0) throw new Error("No picks selected");
  if (name.length < 2) throw new Error("A name is required to vote");
  if (!isValidEmail(email)) throw new Error("A valid email is required to vote");

  const normalized = normalizeEmail(email);
  const hash = await hashEmail(normalized);
  const id = `d${division}_${hash}`;

  const batch = writeBatch(db);
  batch.set(doc(VOTED, id), {
    division,
    voterHash: hash,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(VOTERS, id), {
    name,
    email,
    normalizedEmail: normalized,
    division,
    voterHash: hash,
    picks,
    createdAt: serverTimestamp(),
  });
  for (const nameId of picks) {
    batch.set(
      doc(VOTES, `d${division}_${nameId}`),
      {
        count: increment(1),
        division,
        nameId,
        ballot: id,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
}

// Admin: every ballot cast, newest first (rules probes excluded).
export async function getVoters() {
  const snap = await getDocs(VOTERS);
  const out = [];
  snap.forEach((d) => {
    if (!d.id.includes("_probe-")) out.push({ id: d.id, ...d.data() });
  });
  return out.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

// Is the signed-in account actually allowed to write? Every admin action
// goes through the rules' isAdmin() check, so an address that isn't listed
// there can sign in and see everything but change nothing. Probing a doc
// nothing displays gives a straight answer before anything is attempted.
export async function checkAdminAccess() {
  const ref = doc(db, "config", "adminProbe");
  try {
    await setDoc(ref, { at: serverTimestamp() }, { merge: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err?.code ?? "unknown" };
  } finally {
    await deleteDoc(ref).catch(() => {});
  }
}

// Admin: is the one-ballot-per-email gate actually live? The voter-record
// rules are the same for the admin as for the public, so writing (and
// removing) a probe ballot proves whether the rules have been published.
// Without them every ballot is rejected, so this is checked on page load.
export async function checkVoterGate() {
  const hash = `probe-${Math.random().toString(36).slice(2, 10)}`;
  const id = `d1_${hash}`;
  try {
    // One batch, exactly like a real ballot: the rules require the marker
    // and the voter record to land together.
    const batch = writeBatch(db);
    batch.set(doc(VOTED, id), {
      division: 1,
      voterHash: hash,
      createdAt: serverTimestamp(),
    });
    batch.set(doc(VOTERS, id), {
      name: "Rules probe",
      email: "probe@example.com",
      division: 1,
      voterHash: hash,
      picks: [],
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err?.code ?? "unknown" };
  } finally {
    await Promise.all([
      deleteDoc(doc(VOTED, id)).catch(() => {}),
      deleteDoc(doc(VOTERS, id)).catch(() => {}),
    ]);
  }
}

// Admin: create/update a candidate's display name, bio, and photo.
export async function saveName(id, { name, bio, photoUrl }) {
  await setDoc(
    doc(NAMES, id),
    {
      ...(name !== undefined && { name }),
      ...(bio !== undefined && { bio }),
      ...(photoUrl !== undefined && { photoUrl }),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Admin: bulk-import full nomination rows (the Excel export format:
// Nominee Name / Category / Years Active / Reason / Nominator Name /
// Nominator Email / Division / Division Name / Photo URL / Submitted).
// Doc ids are deterministic per (division, nominee, nominator) so
// re-uploading the same sheet updates rather than duplicates.
export async function addNominations(rows) {
  const entries = [];
  for (const row of rows) {
    const name = String(row.nomineeName ?? "").trim();
    const division = Number(row.division);
    if (!name || !DIVISIONS.includes(division)) continue;
    const who = slugify(String(row.nominatorName ?? "")) || "curated";
    entries.push({
      id: `xls_${division}_${slugify(name)}__${who}`,
      data: {
        nomineeName: name,
        category: String(row.category ?? "").trim(),
        yearsActive: String(row.yearsActive ?? "").trim(),
        reason: String(row.reason ?? "").trim(),
        nominatorName: String(row.nominatorName ?? "").trim(),
        nominatorEmail: String(row.nominatorEmail ?? "").trim(),
        division: String(division),
        divisionName: String(row.divisionName ?? DIVISION_NAMES[division] ?? "").trim(),
        photoUrl: String(row.photoUrl ?? "").trim(),
        photoPath: "",
        submittedAt: String(row.submitted ?? "").trim(),
        importedAt: serverTimestamp(),
      },
    });
  }
  for (let i = 0; i < entries.length; i += 450) {
    const batch = writeBatch(db);
    for (const { id, data } of entries.slice(i, i + 450)) {
      batch.set(doc(NOMINATIONS, id), data, { merge: true });
    }
    await batch.commit();
  }
  return entries.length;
}

// Admin: fetch full nomination docs for a candidate (for review/un-merge).
export async function getNominations(ids) {
  const out = [];
  for (const id of ids) {
    const snap = await getDoc(doc(NOMINATIONS, id));
    if (snap.exists()) out.push({ id, ...snap.data() });
  }
  return out;
}

// Admin: move one nomination to a (possibly new) nominee name — the
// un-merge tool. The ballot rebuilds from nominations automatically.
export async function reassignNomination(docId, newName) {
  await updateDoc(doc(NOMINATIONS, docId), { nomineeName: newName.trim() });
}

// Admin: restore every nomination's nominee name to what was originally
// submitted, recovered from the uploaded photo's filename (the submission
// app embeds the typed name in it). Undoes merges/moves for any
// nomination that has a photo. Returns how many were restored.
export async function restoreFromSubmissions() {
  const snap = await getDocs(NOMINATIONS);
  const fixes = [];
  snap.forEach((ds) => {
    const data = ds.data();
    const m = /_(.+)\.[A-Za-z0-9]+$/.exec(data.photoPath ?? "");
    if (!m) return;
    const original = m[1].replaceAll("_", " ").trim();
    if (original && slugify(original) !== slugify(data.nomineeName ?? "")) {
      fixes.push([ds.id, original]);
    }
  });
  for (let i = 0; i < fixes.length; i += 450) {
    const batch = writeBatch(db);
    for (const [id, name] of fixes.slice(i, i + 450)) {
      batch.update(doc(NOMINATIONS, id), { nomineeName: name });
    }
    await batch.commit();
  }
  return fixes.length;
}

// Admin: wipe an entire collection (names overrides or votes) in chunks.
export async function clearCollection(name) {
  const snap = await getDocs(collection(db, name));
  const ids = [];
  snap.forEach((d) => ids.push(d.id));
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    for (const id of ids.slice(i, i + 450)) {
      batch.delete(doc(db, name, id));
    }
    await batch.commit();
  }
  return ids.length;
}

// Division branding ('51 Legends logos etc.) from the nomination app's
// divisionAssets collection, falling back to the shared default doc. The
// vote's own header logo lives in docs the nomination app never touches
// (`vote51` for every division, `vote51_d{n}` to override just one), so
// uploading it here can't disturb the original site's assets.
export function voteLogoDocId(division = 0) {
  return division ? `vote51_d${division}` : "vote51";
}

export async function loadDivisionAssets(division) {
  try {
    const ids = ["default", String(division), "vote51", voteLogoDocId(division)];
    const snaps = await Promise.all(
      ids.map((id) => getDoc(doc(db, "divisionAssets", id)))
    );
    return snaps.reduce(
      (merged, snap) => (snap.exists() ? { ...merged, ...snap.data() } : merged),
      {}
    );
  } catch {
    return {};
  }
}

// Admin: set the header logo for every division (division 0) or for one.
export async function saveVoteLogo(url, division = 0) {
  await setDoc(
    doc(db, "divisionAssets", voteLogoDocId(division)),
    { logo51: url, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Admin: the header logo currently set for all divisions and per division.
export async function loadVoteLogos() {
  const ids = [0, ...DIVISIONS];
  const snaps = await Promise.all(
    ids.map((d) => getDoc(doc(db, "divisionAssets", voteLogoDocId(d))))
  );
  const out = {};
  snaps.forEach((snap, i) => {
    const url = snap.exists() ? snap.data().logo51 : "";
    if (url) out[ids[i]] = url;
  });
  return out;
}

/* ---------- Board assembly (shared by the live listener and one-shot reads) */

function parseNames(snapshot) {
  const adminNames = new Map(); // slug -> override info, shared across divisions
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    adminNames.set(docSnap.id, {
      name: displayName(docSnap.id, data),
      bio: typeof data.bio === "string" ? data.bio : "",
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      division: typeof data.division === "number" ? data.division : undefined,
    });
  });
  return adminNames;
}

function parseNominations(snapshot) {
  const nominated = new Map(); // division -> Map(slug -> info)
  const nominationDocs = new Map(); // slug -> [nomination doc ids]
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const division = Number(data.division);
    const label = String(data.nomineeName ?? "").trim();
    const id = slugify(label);
    if (!DIVISIONS.includes(division) || !id) return;
    if (!nominated.has(division)) nominated.set(division, new Map());
    const existing = nominated.get(division).get(id) ?? { name: label, photos: [] };
    existing.name = label;
    if (data.photoUrl && !existing.photos.includes(data.photoUrl)) {
      existing.photos.push(data.photoUrl);
    }
    if (!existing.photoUrl && data.photoUrl) existing.photoUrl = data.photoUrl;
    if (!existing.bio && data.reason) existing.bio = String(data.reason);
    if (!existing.category && data.category) existing.category = String(data.category);
    nominated.get(division).set(id, existing);
    const docs = nominationDocs.get(id) ?? [];
    docs.push(docSnap.id);
    nominationDocs.set(id, docs);
  });
  return { nominated, nominationDocs };
}

function parseVotes(snapshot) {
  const votes = new Map();
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const match = /^d(\d+)_(.+)$/.exec(docSnap.id);
    const division = data.division ?? (match ? Number(match[1]) : null);
    const nameId = data.nameId ?? (match ? match[2] : null);
    if (!division || !nameId) return;
    const perName = votes.get(nameId) ?? {};
    perName[division] = data.count ?? 0;
    votes.set(nameId, perName);
  });
  return votes;
}

function buildBoard({ adminNames, nominated, nominationDocs, votes }) {
  const byDivision = {};
  for (const d of DIVISIONS) {
    const merged = new Map(nominated.get(d) ?? []);
    for (const [id, info] of adminNames) {
      // Ballot placement comes from nominations (each carries its
      // division). Admin docs only add a candidate when explicitly
      // scoped: a chosen division, or 0 for all. Legacy docs with no
      // scope act as overrides (bio/photo/name) without adding anyone.
      const scope = info.division;
      if (scope === undefined) continue;
      if (scope !== 0 && scope !== d) continue;
      if (!merged.has(id)) merged.set(id, { name: info.name });
    }
    byDivision[d] = [...merged.entries()]
      .map(([id, info]) => {
        const override = adminNames.get(id) ?? {};
        const photos = [];
        if (override.photoUrl) photos.push(override.photoUrl);
        for (const url of info.photos ?? []) {
          if (!photos.includes(url)) photos.push(url);
        }
        return {
          id,
          name: override.name ?? info.name,
          photoUrl: photos[0] ?? "",
          photos,
          bio: override.bio || info.bio || "",
          category: info.category || "",
          nominationDocIds: nominationDocs.get(id) ?? [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return { byDivision, votes };
}

// One-shot read of the ballot. Live listeners hold a streaming connection
// open, which some mobile browsers refuse inside a cross-site iframe — the
// listener then never fires and never errors, leaving the ballot on
// "Loading…". A plain fetch uses ordinary requests and gets through, so
// the widget falls back to this. Like watchBallot, it never reads votes.
export async function fetchBallotOnce() {
  const [namesSnap, nomsSnap] = await Promise.all([
    getDocs(NAMES),
    getDocs(NOMINATIONS),
  ]);
  return buildBoard({
    adminNames: parseNames(namesSnap),
    ...parseNominations(nomsSnap),
    votes: new Map(),
  });
}

// Public pages call this instead of watchBoard: it subscribes to the
// candidates only, so a visitor's browser never fetches the votes
// collection. Tallies are admin-only — the rules refuse the read anyway.
// The shape matches watchBoard's, with an always-empty votes map.
export function watchBallot(callback, onError) {
  return watchBoard(callback, onError, { withVotes: false });
}

// Calls `callback` with { byDivision, votes } on every change (the admin
// console is the only caller that asks for votes — reading them requires
// admin auth):
//   byDivision: { [division]: [{ id, name, nominationDocIds }] } sorted by name
//   votes: Map of nameId -> { [division]: count }
export function watchBoard(callback, onError, { withVotes = true } = {}) {
  const reportError = (where) => (err) => {
    console.error(`watchBoard ${where}:`, err);
    onError?.(where, err);
  };
  let adminNames = new Map();
  let nominated = new Map();
  let nominationDocs = new Map();
  let votes = new Map();

  const emit = () => {
    callback(buildBoard({ adminNames, nominated, nominationDocs, votes }));
  };

  const stopNames = onSnapshot(NAMES, (snapshot) => {
    adminNames = parseNames(snapshot);
    emit();
  }, reportError("names"));

  const stopNoms = onSnapshot(NOMINATIONS, (snapshot) => {
    ({ nominated, nominationDocs } = parseNominations(snapshot));
    emit();
  }, reportError("nominations"));

  const stopVotes = withVotes
    ? onSnapshot(VOTES, (snapshot) => {
        votes = parseVotes(snapshot);
        emit();
      }, reportError("votes"))
    : null;

  return () => {
    stopNames();
    stopNoms();
    stopVotes?.();
  };
}

export function divisionCount(votes, nameId, division) {
  return votes.get(nameId)?.[division] ?? 0;
}

export function totalCount(votes, nameId) {
  const perName = votes.get(nameId);
  if (!perName) return 0;
  return Object.values(perName).reduce((sum, n) => sum + n, 0);
}

function votedKey(division) {
  return `voted:final-vote:d${division}`;
}

export function hasVoted(division) {
  return localStorage.getItem(votedKey(division)) !== null;
}

export function markVoted(division, ids) {
  localStorage.setItem(votedKey(division), JSON.stringify(ids));
}

// Remember the voter's name/email on this device so someone voting in a
// second division doesn't have to type them again.
const VOTER_KEY = "voter:final-vote";

export function savedVoter() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOTER_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : { name: "", email: "" };
  } catch {
    return { name: "", email: "" };
  }
}

export function saveVoter({ name, email }) {
  try {
    localStorage.setItem(VOTER_KEY, JSON.stringify({ name, email }));
  } catch {
    // private mode — not remembering is fine
  }
}

// The ids this browser voted for (handles the older single-pick format).
export function votedFor(division) {
  const raw = localStorage.getItem(votedKey(division));
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}
