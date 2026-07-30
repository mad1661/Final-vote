import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
export async function addNames(labels) {
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
        { name: label, createdAt: serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return entries.length;
}

// Remove a candidate everywhere (admin): the admin-added name doc, its
// tallies in every division, and any nomination docs for the same person.
export async function removeName(id, nominationDocIds = []) {
  await deleteDoc(doc(NAMES, id));
  const batch = writeBatch(db);
  for (const division of DIVISIONS) {
    batch.delete(doc(VOTES, `d${division}_${id}`));
  }
  for (const docId of nominationDocIds) {
    batch.delete(doc(NOMINATIONS, docId));
  }
  await batch.commit();
}

// Cast one ballot: +1 for each picked name in the division.
export async function castVotes(ids, division) {
  const batch = writeBatch(db);
  for (const id of ids.slice(0, MAX_PICKS)) {
    batch.set(
      doc(VOTES, `d${division}_${id}`),
      {
        count: increment(1),
        division,
        nameId: id,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
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

// Division branding ('51 Legends logos etc.) from the nomination app's
// divisionAssets collection, falling back to the shared default doc.
export async function loadDivisionAssets(division) {
  try {
    const [divSnap, defSnap] = await Promise.all([
      getDoc(doc(db, "divisionAssets", String(division))),
      getDoc(doc(db, "divisionAssets", "default")),
    ]);
    return {
      ...(defSnap.exists() ? defSnap.data() : {}),
      ...(divSnap.exists() ? divSnap.data() : {}),
    };
  } catch {
    return {};
  }
}

// Calls `callback` with { byDivision, votes } on every change:
//   byDivision: { [division]: [{ id, name, nominationDocIds }] } sorted by name
//   votes: Map of nameId -> { [division]: count }
export function watchBoard(callback) {
  let adminNames = new Map(); // slug -> name, shared across divisions
  let nominated = new Map(); // division -> Map(slug -> name)
  let nominationDocs = new Map(); // slug -> [nomination doc ids]
  let votes = new Map();

  const emit = () => {
    const byDivision = {};
    for (const d of DIVISIONS) {
      const merged = new Map(nominated.get(d) ?? []);
      for (const [id, info] of adminNames) {
        if (!merged.has(id)) merged.set(id, { name: info.name });
      }
      byDivision[d] = [...merged.entries()]
        .map(([id, info]) => {
          const override = adminNames.get(id) ?? {};
          return {
            id,
            name: override.name ?? info.name,
            photoUrl: override.photoUrl || info.photoUrl || "",
            bio: override.bio || info.bio || "",
            category: info.category || "",
            nominationDocIds: nominationDocs.get(id) ?? [],
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    callback({ byDivision, votes });
  };

  const stopNames = onSnapshot(NAMES, (snapshot) => {
    adminNames = new Map();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      adminNames.set(docSnap.id, {
        name: displayName(docSnap.id, data),
        bio: typeof data.bio === "string" ? data.bio : "",
        photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      });
    });
    emit();
  });

  const stopNoms = onSnapshot(NOMINATIONS, (snapshot) => {
    nominated = new Map();
    nominationDocs = new Map();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const division = Number(data.division);
      const label = String(data.nomineeName ?? "").trim();
      const id = slugify(label);
      if (!DIVISIONS.includes(division) || !id) return;
      if (!nominated.has(division)) nominated.set(division, new Map());
      const existing = nominated.get(division).get(id) ?? { name: label };
      existing.name = label;
      if (!existing.photoUrl && data.photoUrl) existing.photoUrl = data.photoUrl;
      if (!existing.bio && data.reason) existing.bio = String(data.reason);
      if (!existing.category && data.category) existing.category = String(data.category);
      nominated.get(division).set(id, existing);
      const docs = nominationDocs.get(id) ?? [];
      docs.push(docSnap.id);
      nominationDocs.set(id, docs);
    });
    emit();
  });

  const stopVotes = onSnapshot(VOTES, (snapshot) => {
    votes = new Map();
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
    emit();
  });

  return () => {
    stopNames();
    stopNoms();
    stopVotes();
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
