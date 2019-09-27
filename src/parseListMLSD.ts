import { FileInfo, FileType } from "./FileInfo"

/**
 * Returns true if a given line might be part of an MLSD listing.
 */
export function testLine(line: string): boolean {
    // Examples:
    // - "size=23;type=dir;perm=el;modify=20190218120006; filename"
    // - " filename only"
    return /^\S+=\S+;/.test(line) || line.startsWith(" ")
}

/**
 * Handles an MLSD fact by parsing it and updating `info` in-place. A handler
 * may return `true` if the whole MLSD entry should be disregarded.
 */
type FactHandler = (value: string, info: FileInfo) => boolean | void

function parseSize(value: string, info: FileInfo) {
    info.size = parseInt(value, 10)
}

const factHandlersByName: {[key: string]: FactHandler} = {
    "size": parseSize, // File size
    "sized": parseSize, // Directory size
    "sizd": parseSize, // Directory size
    "modify": (value, info) => { // Modification date
        info.modifiedAt = parseMLSxDate(value)
        info.date = info.modifiedAt.toISOString()
    },
    "type": (value, info) => { // File type
        switch(value) {
            case "file":
                info.type = FileType.File
                break
            case "dir":
                info.type = FileType.Directory
                break
            case "cdir": // Current directory being listed
            case "pdir": // Parent directory
                return true // Don't include these entries in the listing
            default:
                info.type = FileType.Unknown
        }
        return false
    },
    "unix.mode": (value, info) => { // Unix permissions, e.g. 0[1]755
        const digits = value.substr(-3)
        info.permissions = {
            user: parseInt(digits[0], 10),
            group: parseInt(digits[1], 10),
            world: parseInt(digits[2], 10)
        }
    },
    "unix.ownername": (value, info) => { // Owner by name (preferred)
        info.user = value
    },
    "unix.owner": (value, info) => { // Owner by ID
        if (info.user === "") info.user = value
    },
    get "unix.uid"() {
        return this["unix.owner"]
    },
    "unix.groupname": (value, info) => { // Group by name (preferred)
        info.group = value
    },
    "unix.group": (value, info) => { // Group by ID
        if (info.group === "") info.group = value
    },
    get "unix.gid"() {
        return this["unix.group"]
    }
    // Regarding the fact "perm":
    // We don't handle permission information stored in "perm" because its information is conceptually
    // different from what users of FTP clients usually associate with "permissions". Those that have
    // some expectations (and probably want to edit them with a SITE command) often unknowingly expect
    // the Unix permission system. The information passed by "perm" describes what FTP commands can be
    // executed with a file/directory. But even this can be either incomplete or just meant as a "guide"
    // as the spec mentions. From https://tools.ietf.org/html/rfc3659#section-7.5.5: "The permissions are
    // described here as they apply to FTP commands. They may not map easily into particular permissions
    // available on the server's operating system." The parser by Apache Commons tries to translate these
    // to Unix permissions – this is misleading users and might not even be correct.
}

/**
 * Parse MLSD as specified by https://tools.ietf.org/html/rfc3659#section-7.
 *
 * @param line
 */
export function parseLine(line: string): FileInfo | undefined {
    // Example of a line: "size=15227;type=dir;perm=el;modify=20190419065730; test one"
    // Can also be just: " file name"
    const firstSpacePos = line.indexOf(" ")
    const packedFacts = line.substr(0, firstSpacePos)
    const name = line.substr(firstSpacePos + 1)
    if (name === "") {
        return undefined
    }
    const info = new FileInfo(name)
    const facts = packedFacts.split(";")
    for (const fact of facts) {
        const [ factName, factValue ] = fact.split("=", 2)
        if (!factValue) {
            continue
        }
        const factHandler = factHandlersByName[factName.toLowerCase()]
        if (!factHandler) {
            continue
        }
        const shouldIgnoreEntry = factHandler(factValue.toLowerCase(), info)
        if (shouldIgnoreEntry === true) {
            return undefined
        }
    }
    return info
}

/**
 * Parse date as specified in https://tools.ietf.org/html/rfc3659#section-2.3.
 *
 * Message contains response code and modified time in the format: YYYYMMDDHHMMSS[.sss]
 * For example `19991005213102` or `19980615100045.014`.
 *
 * @param fact
 */
export function parseMLSxDate(fact: string): Date {
    const date = new Date()
    date.setUTCFullYear(+fact.slice(0, 4), +fact.slice(4, 6) - 1, +fact.slice(6, 8))
    date.setUTCHours(+fact.slice(8, 10), +fact.slice(10, 12), +fact.slice(12, 14), +fact.slice(15, 18))
    return date
}
