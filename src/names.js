import {
  collection,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase.js";

// Every candidate name is a doc in `names`, keyed by a slug of the name so
// re-submitting an existing name merges instead of duplicating it.
const NAMES = collection(db, "names");

export function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function addName(name) {
  const label = name.trim();
  const id = slugify(label);
  if (!id) throw new Error("Name is empty");
  await setDoc(
    doc(NAMES, id),
    { name: label, votes: increment(0), createdAt: serverTimestamp() },
    { merge: true }
  );
  return id;
}

export async function voteFor(id) {
  await setDoc(
    doc(NAMES, id),
    { votes: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Calls `callback` with [{ id, name, votes }] sorted by votes (then name),
// immediately and on every change.
export function watchNames(callback) {
  return onSnapshot(NAMES, (snapshot) => {
    const names = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      names.push({
        id: docSnap.id,
        name: data.name ?? docSnap.id,
        votes: data.votes ?? 0,
      });
    });
    names.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    callback(names);
  });
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
