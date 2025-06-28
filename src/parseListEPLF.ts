import { FileInfo, FileType } from "./FileInfo"

/**
 * This parser handles EPLF (Easily Parsed LIST Format) directory listings.
 * EPLF format specification: http://cr.yp.to/ftp/list/eplf.html
 *
 * Format: +facts TAB name
 * Facts are comma-separated and can include:
 * - / = directory
 * - r = file
 * - s#### = size in bytes
 * - m#### = modification time (Unix timestamp)
 * - i#### = inode number
 * - up#### = Unix permissions (octal format)
 */

/**
 * Returns true if a given line might be an EPLF-style listing.
 * EPLF lines start with '+' character.
 */
export function testLine(line: string): boolean {
    return line.startsWith('+')
}

/**
 * Parse a single line of an EPLF directory listing.
 */
export function parseLine(line: string): FileInfo | undefined {
    if (!line.startsWith('+')) {
        return undefined
    }

    // Split on tab character or find where filename starts after spaces
    const tabIndex = line.indexOf('\t')
    let factsStr: string
    let filename: string

    if (tabIndex !== -1) {
        // Tab-separated format
        factsStr = line.substring(1, tabIndex) // Remove '+' prefix
        filename = line.substring(tabIndex + 1)
    } else {
        // Space-separated format - find the filename after the facts
        // Find the last comma-separated fact, then look for spaces before filename
        const match = line.match(/^\+(.+?)\s+(\S.*)$/)
        if (!match) {
            return undefined
        }
        factsStr = match[1]
        filename = match[2].trim()
    }

    if (!filename || filename === '.' || filename === '..') {
        return undefined
    }

    const file = new FileInfo(filename)

    // Parse comma-separated facts
    const facts = factsStr.split(',')

    for (const fact of facts) {
        const trimmedFact = fact.trim()

        if (trimmedFact === '/') {
            // Directory indicator
            file.type = FileType.Directory
        } else if (trimmedFact === 'r') {
            // File indicator
            file.type = FileType.File
        } else if (trimmedFact.startsWith('s')) {
            // Size in bytes
            const sizeStr = trimmedFact.substring(1)
            const size = parseInt(sizeStr, 10)
            if (!isNaN(size)) {
                file.size = size
            }
        } else if (trimmedFact.startsWith('m')) {
            // Modification time (Unix timestamp)
            const timestampStr = trimmedFact.substring(1)
            const timestamp = parseInt(timestampStr, 10)
            if (!isNaN(timestamp)) {
                const date = new Date(timestamp * 1000)
                file.rawModifiedAt = date.toISOString()
                file.modifiedAt = date
            }
        } else if (trimmedFact.startsWith('up')) {
            // Unix permissions (octal format)
            const permStr = trimmedFact.substring(2)
            const perm = parseInt(permStr, 8) // Parse as octal
            if (!isNaN(perm)) {
                file.permissions = {
                    user: (perm >> 6) & 7,    // Extract user permissions (bits 6-8)
                    group: (perm >> 3) & 7,   // Extract group permissions (bits 3-5)
                    world: perm & 7           // Extract world permissions (bits 0-2)
                }
            }
        }
        // Note: 'i' (inode) fact is parsed but not stored in FileInfo
        // as there's no corresponding property
    }

    // Default to file type if not specified
    if (file.type === undefined) {
        file.type = FileType.File
    }

    return file
}

export function transformList(files: FileInfo[]): FileInfo[] {
    return files
}
