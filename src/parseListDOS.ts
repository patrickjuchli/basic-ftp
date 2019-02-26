import { FileInfo, FileType } from "./FileInfo"

/**
 * This parser is based on the FTP client library source code in Apache Commons Net provided
 * under the Apache 2.0 license. It has been simplified and rewritten to better fit the Javascript language.
 *
 * http://svn.apache.org/viewvc/commons/proper/net/tags/NET_3_6/src/main/java/org/apache/commons/net/ftp/parser/NTFTPEntryParser.java?revision=1783048&view=markup
 */

const RE_LINE = new RegExp(
    "(\\S+)\\s+(\\S+)\\s+"          // MM-dd-yy whitespace hh:mma|kk:mm swallow trailing spaces
    + "(?:(<DIR>)|([0-9]+))\\s+"    // <DIR> or ddddd swallow trailing spaces
    + "(\\S.*)"                     // First non-space followed by rest of line (name)
)

export function testLine(line: string): boolean {
    // Example: "12-05-96  05:03PM       <DIR>          myDir"
    return line !== undefined && /^\d{2}/.test(line) && RE_LINE.test(line)
}

export function parseLine(line: string): FileInfo | undefined {
    const groups = line.match(RE_LINE)
    if (groups) {
        const name = groups[5]
        if (name === undefined || name === "." || name === "..") {
            return undefined
        }
        const dirStr = groups[3]
        const file = new FileInfo(name)
        if (dirStr === "<DIR>") {
            file.type = FileType.Directory
            file.size = 0
        }
        else {
            file.type = FileType.File
            file.size = parseInt(groups[4], 10)
        }
        file.date = groups[1] + " " + groups[2]
        return file
    }
    return undefined
}
