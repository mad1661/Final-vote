# Legend Vote

Per-division voting for NHRA legends, backed by Firebase (project:
`voting-10a21`). Completely separate from the nomination site — this deploys
to its own Hosting site and each Division 1–7 website embeds its own voting
widget.

## Pages

- `/` — division picker; `/?div=3` — full-page vote for Division 3
- `/embed.html?div=3` — compact widget for embedding in division sites
- `/admin.html` — admin console (Google sign-in): bulk add names by pasting
  or uploading Excel/CSV, live results table across all divisions, remove
  names, and copy-paste embed codes for each division

## Setup

```bash
npm install
npm run dev
```

## How data is stored

- `names/{slug}` — one doc per candidate, shared by all divisions. The
  reader tolerates any doc shape (`name`/`value`/`text`/`title` field or the
  doc id itself). Bulk adds are chunked batches; slug keying merges
  duplicates.
- `votes/d{division}_{nameId}` — one tally doc per name **per division**:
  `{ count, division, nameId, updatedAt }`. Votes are atomic +1 increments.
  Existing name docs are never modified by voting.

A localStorage flag limits each browser to one vote per division.

## Admin setup (one-time, Firebase console)

1. Enable the **Google** provider under
   [Authentication → Sign-in method](https://console.firebase.google.com/project/voting-10a21/authentication/providers).
2. Paste the rules below into
   [Firestore rules](https://console.firebase.google.com/project/voting-10a21/firestore/rules),
   replacing `YOUR-EMAIL@gmail.com` with the Google account you'll use on
   the admin page:

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
      allow write: if isAdmin();
    }
    match /nominations/{nomId} {
      allow read: if true;
      allow create: if true;
      allow update, delete: if isAdmin();
    }
    match /divisionAssets/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }
    match /votes/{voteId} {
      allow read: if true;
      allow create: if request.resource.data.count == 1
                    && request.resource.data.division is int
                    && request.resource.data.division >= 1
                    && request.resource.data.division <= 7;
      allow update: if request.resource.data.diff(resource.data)
                       .affectedKeys().hasOnly(['count', 'updatedAt'])
                    && request.resource.data.count == resource.data.count + 1;
      allow delete: if isAdmin();
    }
  }
}
```

Visitors can read and cast +1 votes; only the admin can manage names.

## Embedding in division sites

One universal snippet works on every division site — the widget detects the
division from the embedding site's domain (`nhradiv1.com` → Division 1,
`nhradiv2.com` → Division 2, … any `div<1-7>`/`division<1-7>` in the
hostname):

```html
<iframe
  src="https://legendvote-final.web.app/embed.html"
  title="Legend Vote"
  style="width:100%;max-width:560px;height:640px;border:0;border-radius:16px;background:#0d0d13"
></iframe>
```

If a site's domain doesn't contain its division number, pin it explicitly
with `embed.html?div=N` (the admin page has copy buttons for both forms).
If neither the URL nor the domain identifies a division, the widget shows a
division chooser so it still works anywhere.

## Deploy

Deploys to the dedicated Hosting site `legendvote-final` — the nomination
site and other Hosting sites in the project are never touched.

```bash
npm run build
firebase deploy --only hosting:vote
```

- Vote site: **https://legendvote-final.web.app**
- Admin: **https://legendvote-final.web.app/admin.html**

## Reference

`site/` contains a copy of the NHRA Division Office (nomination) app for
design reference — it is not part of this deploy.
