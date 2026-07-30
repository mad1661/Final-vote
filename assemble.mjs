// Assembles the final deploy: the original 75 on 75th site (byte-for-byte
// from original-app/public, including its admin.html and asset-manager.html)
// plus the vote pages Vite just built, with quick-nav links injected into
// each page so nothing has to be typed by hand.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";

cpSync("original-app/public", "dist", { recursive: true });

const pill = (href, label, primary = false) =>
  `<a href="${href}" style="text-decoration:none;font:600 12px/1 system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;padding:10px 15px;border-radius:999px;color:#fff;background:${
    primary
      ? "linear-gradient(135deg,#ff2a36,#e30613)"
      : "rgba(18,18,24,.88)"
  };box-shadow:0 4px 14px rgba(0,0,0,.45)">${label}</a>`;

const nav = (links, side = "right") =>
  `\n<div style="position:fixed;bottom:14px;${side}:14px;z-index:99999;display:flex;gap:8px;flex-wrap:wrap">${links.join(
    ""
  )}</div>\n`;

function inject(file, html) {
  if (!existsSync(file)) {
    console.warn(`assemble: missing ${file}, skipped`);
    return;
  }
  let s = readFileSync(file, "utf8");
  s = s.includes("</body>") ? s.replace("</body>", `${html}</body>`) : s + html;
  writeFileSync(file, s);
}

// Public pages: nomination home gets a Vote button; vote page links home.
inject("dist/index.html", nav([pill("/vote", "Vote Now", true)]));
inject("dist/vote.html", nav([pill("/", "Nominate")], "left"));

// Admin-side pages: full quick-nav between all consoles.
inject(
  "dist/admin.html",
  nav([
    pill("/", "Home"),
    pill("/vote", "Vote", true),
    pill("/vote-admin.html", "Vote Admin"),
    pill("/asset-manager.html", "Assets"),
  ])
);
inject(
  "dist/asset-manager.html",
  nav([
    pill("/", "Home"),
    pill("/vote", "Vote", true),
    pill("/vote-admin.html", "Vote Admin"),
    pill("/admin.html", "Site Admin"),
  ])
);
inject(
  "dist/vote-admin.html",
  nav([
    pill("/", "Home"),
    pill("/vote", "Vote", true),
    pill("/admin.html", "Site Admin"),
    pill("/asset-manager.html", "Assets"),
  ])
);

console.log("assembled: original site + vote pages + nav links");
