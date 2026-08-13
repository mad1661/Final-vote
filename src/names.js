import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase.js";

export const DIVISIONS = [1, 2, 3, 4, 5, 6, 7];

// Candidate names are shared across divisions; each division has its own
// tally per name, stored in `votes` as doc id `d{division}_{nameId}`.
export const NAMES_COLLECTION = "names";

const NAMES = collection(db, NAMES_COLLECTION);
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

// Remove a candidate and its tallies in every division (admin).
export async function removeName(id) {
  await deleteDoc(doc(NAMES, id));
  const batch = writeBatch(db);
  for (const division of DIVISIONS) {
    batch.delete(doc(VOTES, `d${division}_${id}`));
  }
  await batch.commit();
}

export async function voteFor(id, division) {
  await setDoc(
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

// Calls `callback` with [{ id, name }] (alphabetical) on every change to
// the names collection. Public pages use this instead of watchBoard so
// vote tallies are never streamed to visitors' browsers — only the
// signed-in admin console reads the votes collection.
export function watchNames(callback) {
  return onSnapshot(NAMES, (snapshot) => {
    const list = [];
    snapshot.forEach((docSnap) => {
      list.push({
        id: docSnap.id,
        name: displayName(docSnap.id, docSnap.data()),
      });
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    callback(list);
  });
}

// Calls `callback` with { names, votes } on every change to either
// collection (admin console only — vote reads require admin auth):
//   names: [{ id, name }] sorted alphabetically
//   votes: Map of nameId -> { [division]: count }
export function watchBoard(callback) {
  let names = new Map();
  let votes = new Map();

  const emit = () => {
    const list = [...names.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    callback({ names: list, votes });
  };

  const stopNames = onSnapshot(NAMES, (snapshot) => {
    names = new Map();
    snapshot.forEach((docSnap) => {
      names.set(docSnap.id, displayName(docSnap.id, docSnap.data()));
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

export function markVoted(division, id) {
  localStorage.setItem(votedKey(division), id);
}

export function votedFor(division) {
  return localStorage.getItem(votedKey(division));
}
