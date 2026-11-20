// Every published entry point must exist after a build, JS and types.
const fs = require("fs");
const pkg = require("../package.json");

const missing = [];
for (const [subpath, target] of Object.entries(pkg.exports)) {
  if (typeof target === "string") continue;
  for (const kind of ["types", "import", "require"]) {
    if (!fs.existsSync(target[kind])) missing.push(`${subpath} ${kind}: ${target[kind]}`);
  }
  // The package has no "type", so Node reads a .js file as CommonJS: an
  // ES module must be .mjs or `import` fails before Node 22.
  if (!target.import.endsWith(".mjs")) missing.push(`${subpath} import: ${target.import} is not .mjs`);
}
// The React wrapper uses hooks: a Next.js Server Component can import it
// only if the bundle opens with the "use client" directive.
for (const file of ["dist/react.mjs", "dist/react.cjs.js"]) {
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").startsWith('"use client";'))
    missing.push(`${file}: does not start with "use client"`);
}
if (missing.length > 0) {
  console.error("Build output missing:\n  " + missing.join("\n  "));
  process.exit(1);
}

// Every entry loads by name in Node, as an ES module and through require,
// without Node guessing the module type.
process.on("warning", (warning) => {
  if (warning.code === "MODULE_TYPELESS_PACKAGE_JSON") missing.push(warning.message);
});
(async () => {
  for (const subpath of Object.keys(pkg.exports)) {
    if (subpath === "./package.json") continue;
    const name = pkg.name + subpath.slice(1);
    try {
      await import(name);
      require(name);
    } catch (error) {
      missing.push(`${name}: ${error.message}`);
    }
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (missing.length > 0) {
    console.error("Build output does not load:\n  " + missing.join("\n  "));
    process.exit(1);
  }
  console.log(`Build verified: ${Object.keys(pkg.exports).length} entry points.`);
})();
