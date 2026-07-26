// Extract the current version's section from CHANGELOG.md and write it to
// release-notes.md, so the GitHub release body shows the curated changelog
// instead of GitHub's auto-generated commit list.
import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const md = readFileSync("CHANGELOG.md", "utf8");

// Match "## [X.Y.Z]" up to the next "## [" / "## " or end of file.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = new RegExp(
  "^## \\[" + escaped + "\\][\\s\\S]*?(?=\\n## \\[|\\n## |\\Z)",
  "m",
);
const m = md.match(re);
const body = m ? m[0].trim() : "See [CHANGELOG.md](CHANGELOG.md) for details.";

writeFileSync("release-notes.md", body);
console.log(`Notes for ${version} -> ${body.length} chars`);
