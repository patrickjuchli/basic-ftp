import * as path from "path"

/**
 * Returns true if a name from a directory listing can only refer to an entry directly inside a
 * local directory when joined with its path.
 */
export function isSafePathName(name: string, localPath: typeof path = path): boolean {
    if (!name || name === "." || name === ".." || name.includes("/")) {
        return false
    }
    if (localPath.sep === "\\") {
        // Windows also separates with "\", reads ":" as a drive (older Node joins "." and "C:" to
        // "C:", see CVE-2025-23084) and ignores trailing dots and spaces, so ".. " acts like "..".
        return !/[\\:]/.test(name) && !/^[. ]+$/.test(name)
    }
    return true
}
