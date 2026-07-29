# Final Vote

A voting web app backed by Firebase (project: `voting-10a21`).

The final round: every submitted name already in Firestore is listed as a
candidate, anyone can add more names, and each visitor casts one vote.
Tallies update live for everyone viewing the page.

**The app never modifies existing name documents.** It only reads the names
collection (and appends new docs when a name is added). Vote tallies are
stored in a separate `votes` collection.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL — the submitted names appear automatically — and
vote (open a second tab to see live sync).

## Structure

- `src/firebase.js` — initializes the Firebase app, Firestore (`db`), and Analytics
- `src/names.js` — reads the existing names, appends new ones, and records votes
- `src/main.js` — app entry point: renders the name list, add-name form, and voting
- `index.html` — page shell and styles (Vite entry)

## How data is stored

Submitted names live in the `names` collection — whatever documents are
already there are displayed as-is. The app looks for the name text in a
`name` / `value` / `text` / `title` field (falling back to the document id),
so it works with the existing document shape.

If your names live in a differently-named collection, change the
`NAMES_COLLECTION` constant at the top of `src/names.js`.

Votes are kept separate so existing data is never touched:

```
votes/{nameDocId}: { count: number, updatedAt }
```

Each vote atomically increments `count`. The UI subscribes to both
collections with `onSnapshot` and merges them for live, sorted results. A
localStorage flag limits each browser to one vote.

## Firestore security rules

If the current rules deny unauthenticated access, the app can't read the
names or record votes. Open
[Firestore rules](https://console.firebase.google.com/project/voting-10a21/firestore/rules)
and allow:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /names/{nameId} {
      allow read: if true;
      allow create: if request.resource.data.name is string
                    && request.resource.data.name.size() <= 80;
    }
    match /votes/{nameId} {
      allow read: if true;
      allow create: if request.resource.data.count == 1;
      allow update: if request.resource.data.diff(resource.data)
                       .affectedKeys().hasOnly(['count', 'updatedAt'])
                    && request.resource.data.count == resource.data.count + 1;
    }
  }
}
```

Existing name documents stay read-only under these rules.

## Build

```bash
npm run build
```
