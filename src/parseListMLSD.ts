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
 * Parses an MLSD fact and updates `info` in-place. May return `true`
 * if the whole MLSD entry should be disregarded.
 */
type FactHandler = (value: string, info: FileInfo) => boolean | void

function parseSize(value: string, info: FileInfo) {
    info.size = parseInt(value, 10)
}

const factHandlersByName: {[key: string]: FactHandler} = {
    "size": parseSize, // File size
    "sizd": parseSize, // Directory size
    "unique": (value, info) => { // Unique identifier
        info.uniqueID = value
    },
    "modify": (value, info) => { // Modification date
        info.modifiedAt = parseMLSxDate(value)
        info.rawModifiedAt = info.modifiedAt.toISOString()
    },
    "type": (value, info) => { // File type
        // There seems to be confusion on how to handle symbolic links for Unix. RFC 3659 doesn't describe
        // this but mentions some examples using the syntax `type=OS.unix=slink:<target>`. But according to
        // an entry in the Errata (https://www.rfc-editor.org/errata/eid1500) this syntax can't be valid.
        // Instead it proposes to use `type=OS.unix=symlink` and to then list the actual target of the
        // symbolic link as another entry in the directory listing. The unique identifiers can then be used
        // to derive the connection between link(s) and target. We'll have to handle both cases as there
        // are differing opinions on how to deal with this. Here are some links on this topic:
        // - ProFTPD source: https://github.com/proftpd/proftpd/blob/56e6dfa598cbd4ef5c6cba439bcbcd53a63e3b21/modules/mod_facts.c#L531
        // - ProFTPD bug: http://bugs.proftpd.org/show_bug.cgi?id=3318
        // - ProFTPD statement: http://www.proftpd.org/docs/modules/mod_facts.html
        // – FileZilla bug: https://trac.filezilla-project.org/ticket/9310
        if (value.startsWith("OS.unix=slink")) {
            info.type = FileType.SymbolicLink
            info.link = value.substr(value.indexOf(":") + 1)
            return false
        }
        switch(value) {
            case "file":
                info.type = FileType.File
                break
            case "dir":
                info.type = FileType.Directory
                break
            case "OS.unix=symlink":
                info.type = FileType.SymbolicLink
                // The target of the symbolic link might be defined in another line in the directory listing.
                // We'll handle this in `transformList()` below.
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
        if (info.user === undefined) info.user = value
    },
    get "unix.uid"() {
        return this["unix.owner"]
    },
    "unix.groupname": (value, info) => { // Group by name (preferred)
        info.group = value
    },
    "unix.group": (value, info) => { // Group by ID
        if (info.group === undefined) info.group = value
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
        const firstEqualSignPos = fact.indexOf("=") // Consider `type=OS.unix=slink:<target>`
        const factName = fact.substr(0, firstEqualSignPos)
        const factValue = fact.substr(firstEqualSignPos + 1)
        if (!factValue) {
            continue
        }
        const factHandler = factHandlersByName[factName.toLowerCase()]
        if (!factHandler) {
            continue
        }
        const shouldIgnoreEntry = factHandler(factValue, info)
        if (shouldIgnoreEntry === true) {
            return undefined
        }
    }
    return info
}

export function transformList(files: FileInfo[]): FileInfo[] {
    // Resolve symbolic links encoded as `type=OS.unix=symlink`. The corresponding target will be
    // somewhere in the list. We can identify it using the unique identifier fact.
    const unresolvedSymLinks: FileInfo[] = []
    for (const file of files) {
        if (file.type === FileType.SymbolicLink && file.link === undefined && file.uniqueID !== undefined) {
            unresolvedSymLinks.push(file)
        }
    }
    if (unresolvedSymLinks.length === 0) {
        return files
    }
    const resolvedFiles: FileInfo[] = []
    for (const file of files) {
        // It's possible that multiple symbolic links point to the same target.
        // We can't resolve anything without unique identifiers.
        if (file.type !== FileType.SymbolicLink && file.uniqueID !== undefined) {
            for (const symLink of unresolvedSymLinks) {
                if (symLink.uniqueID === file.uniqueID) {
                    symLink.link = file.name
                }
            }
        }
        // The targets of a symbolic link is listed as a file in the directory listing but might
        // have a path pointing outside of this directory. In that case we don't want this entry
        // to be part of the listing. We don't want these kind of entries in general.
        const isDirectoryFile = !file.name.includes("/")
        if (isDirectoryFile) {
            resolvedFiles.push(file)
        }
    }
    return resolvedFiles
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
