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

- `voted/d{division}_{hash}` — the one-ballot-per-person marker: a SHA-256
  hash of the voter's email, no address stored. Create-only, so a second
  ballot from the same email is refused by the rules — and because the
  tallies are written in the same batch, the whole ballot is refused with it.
- `voters/d{division}_{hash}` — the matching record (`name`, `email`,
  `division`, `picks`), readable by the admin only, exported from the
  vote admin page.

Voters must enter a name and email on the confirm step before their picks
count. Gmail aliases (`m.ark+vote@gmail.com`) normalize to one identity, so
tagged addresses can't be used to vote repeatedly. A localStorage flag also
stops the same browser from re-opening the ballot in a division.

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
    // A ballot only counts when it arrives with a brand-new voter marker in
    // the same batch, so tallies can't be bumped without identifying a voter.
    function withBallot() {
      return request.resource.data.ballot is string
             && getAfter(/databases/$(database)/documents/voted/$(request.resource.data.ballot))
                  .data.division == request.resource.data.division;
    }
    match /votes/{voteId} {
      allow read: if true;
      allow create: if isAdmin()
                    || (request.resource.data.count >= 1
                        && request.resource.data.count <= 5
                        && request.resource.data.division is int
                        && request.resource.data.division >= 1
                        && request.resource.data.division <= 7
                        && withBallot());
      allow update: if isAdmin()
                    || (request.resource.data.diff(resource.data)
                          .affectedKeys().hasOnly(['count', 'updatedAt', 'ballot'])
                        && request.resource.data.count > resource.data.count
                        && request.resource.data.count <= resource.data.count + 5
                        && withBallot());
      allow delete: if isAdmin();
    }
    // One ballot per email per division. The id is d{division}_{hash of the
    // email}, and create-only means a second attempt is rejected — which
    // fails the whole batch, tallies included. No addresses are stored here.
    match /voted/{voterId} {
      allow read: if true;
      allow create: if request.resource.data.division is int
                    && request.resource.data.division >= 1
                    && request.resource.data.division <= 7
                    && request.resource.data.voterHash is string
                    && voterId == 'd' + string(request.resource.data.division)
                                  + '_' + request.resource.data.voterHash
                    // ...and only alongside the name/email record itself
                    && getAfter(/databases/$(database)/documents/voters/$(voterId))
                         .data.voterHash == request.resource.data.voterHash;
      allow update: if false;
      allow delete: if isAdmin();
    }
    // The matching record with the voter's name and email — write-once by
    // the public, readable only by the admin.
    match /voters/{voterId} {
      allow read: if isAdmin();
      allow create: if request.resource.data.name is string
                    && request.resource.data.name.size() >= 2
                    && request.resource.data.email is string
                    && request.resource.data.email.size() >= 5
                    && request.resource.data.division is int
                    && request.resource.data.voterHash is string
                    && voterId == 'd' + string(request.resource.data.division)
                                  + '_' + request.resource.data.voterHash;
      allow update: if false;
      allow delete: if isAdmin();
    }
  }
}
```

Visitors can read and cast +1 votes; only the admin can manage names or read
the voter list.

## Header logo

The '51 Legends shield at the top of the vote page and every embedded widget
is uploaded from the vote admin's **Header logo** section — no file copying
or redeploy needed. It saves to Storage under `division-assets/vote/` (the
prefix the deployed Storage rules already allow the admin to write) and
records the URL in `divisionAssets/vote51`, a doc the nomination app never
touches. Choosing a single division instead writes `divisionAssets/vote51_d{n}`
and only that division's ballot changes.

If nothing is uploaded the widget falls back, in order, to
`/51-legends-d{division}.png`, `/51-legends.png`, the nomination app's
`logo75` asset, and finally `/nhra-75-logo.png`.

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
