import {
  collection,
  doc,
  increment,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase.js";

// A single poll for now; each option is a doc in the poll's `options`
// subcollection carrying a running `count`.
export const POLL_ID = "final-vote";

export const POLL = {
  question: "What should we build next?",
  options: [
    { id: "mobile-app", label: "Mobile app" },
    { id: "dark-mode", label: "Dark mode" },
    { id: "live-chat", label: "Live chat" },
    { id: "integrations", label: "More integrations" },
  ],
};

function optionRef(optionId) {
  return doc(db, "polls", POLL_ID, "options", optionId);
}

export async function castVote(optionId) {
  await setDoc(
    optionRef(optionId),
    { count: increment(1), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Calls `callback` with { [optionId]: count } now and on every change.
export function watchResults(callback) {
  const options = collection(db, "polls", POLL_ID, "options");
  return onSnapshot(options, (snapshot) => {
    const counts = {};
    snapshot.forEach((docSnap) => {
      counts[docSnap.id] = docSnap.data().count ?? 0;
    });
    callback(counts);
  });
}

const VOTED_KEY = `voted:${POLL_ID}`;

export function hasVoted() {
  return localStorage.getItem(VOTED_KEY) !== null;
}

export function markVoted(optionId) {
  localStorage.setItem(VOTED_KEY, optionId);
}

export function votedFor() {
  return localStorage.getItem(VOTED_KEY);
}
