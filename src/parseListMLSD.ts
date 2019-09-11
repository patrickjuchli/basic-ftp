import { FileInfo, FileType } from "./FileInfo"

export function testLine(line: string): boolean {
    // Example: "size=23;type=dir;perm=el;modify=20190218120006; filename"
    return line !== undefined && line.toLowerCase().indexOf("size=") !== -1
}

/**
 * Parse MLSD as specified by https://tools.ietf.org/html/rfc3659#section-7.
 *
 * Based on the parser at https://github.com/apache/commons-net/blob/master/src/main/java/org/apache/commons/net/ftp/parser/MLSxEntryParser.java
 * provided under the Apache 2.0 licence. There are many conceptual changes here, impractical to list all of them.
 *
 * @param line
 */
export function parseLine(line: string): FileInfo | undefined {
    const hasNoFacts = line.startsWith(" ")
    if (hasNoFacts) {
        const name = line.substr(1)
        return name !== "" ? new FileInfo(name) : undefined
    }
    // Example of a line: "size=15227;type=dir;perm=el;modify=20190419065730; test one"
    const factsAndName = line.split("; ", 2)
    if (factsAndName.length !== 2) {
        return undefined
    }
    const facts = factsAndName[0].split(";")
    const name = factsAndName[1]
    if (name === "") {
        return undefined
    }
    const info = new FileInfo(name)
    for (const fact of facts) {
        let [factName, factValue] = fact.split("=", 2)
        if (!factValue) {
            continue
        }
        factName = factName.toLowerCase()
        factValue = factValue.toLowerCase()
        if (factName === "size" || factName === "sized") {
            info.size = parseInt(factValue, 10)
        }
        else if (factName === "modify") {
            info.modifiedAt = parseMLSxDate(factValue)
            info.date = info.modifiedAt.toISOString()
        }
        else if (factName === "type") {
            if (factValue === "file") {
                info.type = FileType.File
            }
            else if (factValue === "dir") {
                info.type = FileType.Directory
            }
            else if (factValue === "cdir" || factValue === "pdir") {
                // Don't include the directory that is being listed (cdir) nor any parent directory (pdir).
                return undefined
            }
            else {
                info.type = FileType.Unknown
            }
        }
        else if (factName === "unix.group") {
            info.group = factValue
        }
        else if (factName === "unix.owner") {
            info.user = factValue
        }
        else if (factName === "unix.mode") { // e.g. 0[1]755
            const digits = factValue.substr(-3)
            info.permissions = {
                user: parseInt(digits[0], 10),
                group: parseInt(digits[1], 10),
                world: parseInt(digits[2], 10)
            }
        }
        // Regarding the fact "perm":
        // We don't handle permission information stored in "perm" because its information is conceptually
        // very far away from what users of FTP clients usually associate with "permissions". Those that have
        // some expectations (and probably want to edit them with a SITE command) often unknowingly expect
        // the Unix permission system. The information passed by "perm" describes what FTP commands can be
        // executed with a file/directory. But even this can be either incomplete or just meant as a "guide"
        // as the spec mentions. From https://tools.ietf.org/html/rfc3659#section-7.5.5: "The permissions are
        // described here as they apply to FTP commands. They may not map easily into particular permissions
        // available on the server's operating system."
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
