import { FileInfo } from "./FileInfo"
import * as dosParser from "./parseListDOS"
import * as unixParser from "./parseListUnix"

interface Parser {
    testLine(line: string): boolean
    parseLine(line: string): FileInfo | undefined
}

const availableParsers: Parser[] = [
    dosParser,
    unixParser
]

/**
 * Parse raw directory listing.
 */
export function parseList(rawList: string): FileInfo[] {
    const lines = rawList.split(/\r?\n/) // Split by newline
        .map(line => (/^(\d\d\d)-/.test(line)) ? line.substr(3) : line) // Strip possible multiline prefix
        .filter(line => line.trim() !== "") // Remove blank lines
    if (lines.length === 0) {
        return []
    }
    // Pick the last line of the list as a test candidate to find a compatible parser.
    const test = lines[lines.length - 1]
    const parser = firstCompatibleParser(test, availableParsers)
    if (!parser) {
        throw new Error("This library only supports Unix- or DOS-style directory listing. Your FTP server seems to be using another format. You can see the transmitted listing when setting `client.ftp.verbose = true`. You can then provide a custom parser to `client.parseList`, see the documentation for details.")
    }
    return lines.map(parser.parseLine)
        .filter((info): info is FileInfo => info !== undefined)
}

/**
 * Returns the first parser that doesn't return undefined for the given line.
 */
function firstCompatibleParser(line: string, parsers: Parser[]) {
    return parsers.find(parser => parser.testLine(line) === true)
}
