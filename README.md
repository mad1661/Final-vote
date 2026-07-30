# Final Vote

A voting web app backed by Firebase (project: `voting-10a21`).

The final round: every submitted name in Firestore is listed as a candidate
and each visitor casts one vote. Tallies update live for everyone viewing
the page. An admin page lets you bulk-load names (paste a list or upload an
Excel/CSV file), see counts, and remove entries.

**The vote page never modifies existing name documents.** It only reads the
names collection. Vote tallies are stored in a separate `votes` collection.

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL — the submitted names appear automatically — and
vote (open a second tab to see live sync). The admin page is at
`/admin.html`.

## Structure

- `src/firebase.js` — initializes the Firebase app, Firestore (`db`), and Analytics
- `src/names.js` — reads names, bulk-adds, removes, and records votes
- `src/main.js` — public vote page: name list, add-name form, voting
- `src/admin.js` — admin page: Google sign-in, bulk add (paste/Excel/CSV), manage names
- `index.html` / `admin.html` — page shells and styles (Vite entries)

## Admin page

Visit `/admin.html` and sign in with Google. From there you can:

- **Bulk add names** — paste a list (one per line, commas also fine), or
  upload an `.xlsx` / `.xls` / `.csv` file; every filled-in cell is treated
  as a name. Duplicates merge automatically instead of creating copies.
- **See live vote counts** per name.
- **Remove** a name (and its votes).

One-time setup in the Firebase console: enable the **Google** provider under
[Authentication → Sign-in method](https://console.firebase.google.com/project/voting-10a21/authentication/providers).

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

Open
[Firestore rules](https://console.firebase.google.com/project/voting-10a21/firestore/rules),
paste the rules below, and **replace `YOUR-EMAIL@gmail.com` with the Google
account email you'll use on the admin page**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null
             && request.auth.token.email == 'YOUR-EMAIL@gmail.com';
    }
    match /names/{nameId} {
      allow read: if true;
      allow create: if isAdmin()
                    || (request.resource.data.name is string
                        && request.resource.data.name.size() <= 80);
      allow update, delete: if isAdmin();
    }
    match /votes/{nameId} {
      allow read: if true;
      allow create: if request.resource.data.count == 1;
      allow update: if request.resource.data.diff(resource.data)
                       .affectedKeys().hasOnly(['count', 'updatedAt'])
                    && request.resource.data.count == resource.data.count + 1;
      allow delete: if isAdmin();
    }
  }
}
```

Visitors can read names and cast +1 votes; only the admin account can
bulk-manage names or remove anything.

## Build

```bash
npm run build
```

## Deploying next to the existing site (without touching it)

The voting app deploys to its **own Firebase Hosting site**
(`legendvote-final`) inside the same project, so the existing sites
(`legendvote`, etc.) are never modified or overwritten.

```bash
npm install
npm run build
firebase deploy --only hosting:vote
```

- Vote page: **https://legendvote-final.web.app**
- Admin page: **https://legendvote-final.web.app/admin.html**

Finally, add a link (e.g. "Vote") from your existing site to the vote URL.
