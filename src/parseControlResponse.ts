const LF = "\n"

export interface ParsedResponse {
    readonly messages: string[]
    readonly rest: string
}

/**
 * Parse an FTP control response as a collection of messages. A message is a complete
 * single- or multiline response. A response can also contain multiple multiline responses
 * that will each be represented by a message. A response can also be incomplete
 * and be completed on the next incoming data chunk for which case this function also
 * describes a `rest`. This function converts all CRLF to LF.
 */
export function parseControlResponse(text: string): ParsedResponse {
    const lines = text.split(/\r?\n/)
    const messages = []
    let startAt = 0
    let tokenRegex: RegExp | undefined
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // No group has been opened.
        if (!tokenRegex) {
            if (isMultiline(line)) {
                // Open a group by setting an expected token.
                const token = line.substr(0, 3)
                tokenRegex = new RegExp(`^${token}(?:$| )`)
                startAt = i
            }
            else if (isSingle(line)) {
                // Single lines can be grouped immediately.
                messages.push(line)
            }
        }
        // Group has been opened, expect closing token.
        else if (tokenRegex.test(line)) {
            tokenRegex = undefined
            messages.push(lines.slice(startAt, i + 1).join(LF))
        }
    }
    // The last group might not have been closed, report it as a rest.
    const rest = tokenRegex ? lines.slice(startAt).join(LF) + LF : ""
    return { messages, rest }
}

function isSingle(line: string) {
    return /^\d\d\d(?:$| )/.test(line)
}

function isMultiline(line: string) {
    return /^\d\d\d-/.test(line)
}
