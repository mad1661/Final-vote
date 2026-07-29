# Final Vote

A voting web app backed by Firebase (project: `voting-10a21`).

Visitors pick an option in a poll; votes are stored in Firestore and results
update live for everyone viewing the page.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL, pick an option, and watch the tallies update in
real time (open a second tab to see live sync).

## Structure

- `src/firebase.js` — initializes the Firebase app, Firestore (`db`), and Analytics
- `src/votes.js` — poll definition, vote writes, and live results subscription
- `src/main.js` — app entry point: renders the poll UI and wires up voting
- `index.html` — page shell and styles (Vite entry)

## How votes are stored

Each poll option is a document at `polls/final-vote/options/{optionId}` with a
running `count` field, incremented atomically on each vote. The UI subscribes
to that collection with `onSnapshot` for live results. A localStorage flag
prevents casual repeat voting from the same browser.

> Note: Firestore security rules should allow reads on
> `polls/{pollId}/options/{optionId}` and restrict writes to count increments.

## Build

```bash
npm run build
```
