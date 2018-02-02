"use strict";

const ignoredFilenames = new Set([
    // MacOS
    ".DS_Store", 
    ".AppleDouble", 
    ".LSOverride",
    // Windows
    "Thumbs.db", 
    "ehthumbs.db", 
    "ehthumbs_vista.db"
]);

module.exports = function uploadDirFileFilter(filename) {
    return ignoredFilenames.has(filename) === false;
};
