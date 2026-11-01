// Prints the CHANGELOG.md entry for the version in package.json, fails if there is none.
const fs = require("fs");

const version = require("../../package.json").version;
const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
const entry = changelog.split(/^## /m).find(section => section.startsWith(version + "\n"));
if (!entry) {
    console.error(`CHANGELOG.md has no entry for ${version}`);
    process.exit(1);
}
console.log(entry.slice(version.length).trim());
