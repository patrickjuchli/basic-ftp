import { FileInfo } from "./FileInfo"
import * as dosParser from "./parseListDOS"
import * as unixParser from "./parseListUnix"
import * as mlsdParser from "./parseListMLSD"

interface Parser {
    testLine(line: string): boolean
    parseLine(line: string): FileInfo | undefined
    transformList(files: FileInfo[]): FileInfo[]
}

/**
 * Available directory listing parsers. These are candidates that will be tested
 * in the order presented. The first candidate will be used to parse the whole list.
 */
const availableParsers: Parser[] = [
    dosParser,
    unixParser,
    mlsdParser // Keep MLSD last, may accept filename only
]

function firstCompatibleParser(line: string, parsers: Parser[]) {
    return parsers.find(parser => parser.testLine(line) === true)
}

function stringIsNotBlank(str: string) {
    return str.trim() !== ""
}

const REGEX_NEWLINE = /\r?\n/

/**
 * Parse raw directory listing.
 */
export function parseList(rawList: string): FileInfo[] {
    const lines = rawList
        .split(REGEX_NEWLINE)
        .filter(stringIsNotBlank)
    if (lines.length === 0) {
        return []
    }
    const testLine = lines[lines.length - 1]
    const parser = firstCompatibleParser(testLine, availableParsers)
    if (!parser) {
        throw new Error("This library only supports MLSD, Unix- or DOS-style directory listing. Your FTP server seems to be using another format. You can see the transmitted listing when setting `client.ftp.verbose = true`. You can then provide a custom parser to `client.parseList`, see the documentation for details.")
    }
    const files = lines
        .map(parser.parseLine)
        .filter((info): info is FileInfo => info !== undefined)
    return parser.transformList(files)
}
