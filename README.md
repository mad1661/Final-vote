# Final Vote

A voting web app backed by Firebase (project: `voting-10a21`).

The final round: every submitted name is listed as a candidate, anyone can
add more names, and each visitor casts one vote. Tallies update live for
everyone viewing the page.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL, add names if any are missing, and vote (open a
second tab to see live sync).

## Structure

- `src/firebase.js` — initializes the Firebase app, Firestore (`db`), and Analytics
- `src/names.js` — name submissions, vote writes, and the live names subscription
- `src/main.js` — app entry point: renders the name list, add-name form, and voting
- `index.html` — page shell and styles (Vite entry)

## How data is stored

Each candidate name is a document in the `names` collection, keyed by a slug
of the name (so re-submitting an existing name merges instead of duplicating):

```
names/{slug}: { name: string, votes: number, createdAt, updatedAt }
```

Votes increment the `votes` field atomically. The UI subscribes to the
collection with `onSnapshot` for live results, sorted by vote count. A
localStorage flag limits each browser to one vote.

## Firestore security rules

The project's current rules deny unauthenticated access, which blocks this
app. Open [Firestore rules](https://console.firebase.google.com/project/voting-10a21/firestore/rules)
and allow access to the `names` collection, e.g.:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /names/{nameId} {
      allow read: if true;
      allow create: if request.resource.data.name is string
                    && request.resource.data.name.size() <= 80;
      allow update: if request.resource.data.diff(resource.data)
                       .affectedKeys().hasOnly(['votes', 'updatedAt'])
                    && request.resource.data.votes == resource.data.votes + 1;
    }
  }
}
```

## Build

```bash
npm run build
```
