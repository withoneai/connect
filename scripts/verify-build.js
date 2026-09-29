// Every published entry point must exist after a build, JS and types.
const fs = require("fs");
const pkg = require("../package.json");

const missing = [];
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (typeof target === "string") continue;
  for (const kind of ["types", "import", "require"]) {
    if (!fs.existsSync(target[kind])) missing.push(`${subpath} ${kind}: ${target[kind]}`);
  }
}
// The React wrapper uses hooks: a Next.js Server Component can import it
// only if the bundle opens with the "use client" directive.
for (const file of ["dist/react.esm.js", "dist/react.cjs.js"]) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").startsWith('"use client";'))
    missing.push(`${file}: does not start with "use client"`);
}
if (missing.length > 0) {
  console.error("Build output missing:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`Build verified: ${Object.keys(pkg.exports).length} entry points.`);
