import {
  collection,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase.js";

// Collection that already holds the submitted names. The app only reads it
// (and appends new docs via the add-name form) — it never modifies existing
// documents. Vote tallies live in the separate `votes` collection, one doc
// per name keyed by the name doc's id.
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

export async function voteFor(id) {
  await setDoc(
    doc(VOTES, id),
    { count: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Calls `callback` with [{ id, name, votes }] sorted by votes (then name),
// immediately and on every change to either collection.
export function watchNames(callback) {
  let names = new Map();
  let votes = new Map();

  const emit = () => {
    const out = [...names.entries()].map(([id, name]) => ({
      id,
      name,
      votes: votes.get(id) ?? 0,
    }));
    out.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    callback(out);
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
      votes.set(docSnap.id, docSnap.data().count ?? 0);
    });
    emit();
  });

  return () => {
    stopNames();
    stopVotes();
  };
}

const VOTED_KEY = "voted:final-vote";

export function hasVoted() {
  return localStorage.getItem(VOTED_KEY) !== null;
}

export function markVoted(id) {
  localStorage.setItem(VOTED_KEY, id);
}

export function votedFor() {
  return localStorage.getItem(VOTED_KEY);
}
