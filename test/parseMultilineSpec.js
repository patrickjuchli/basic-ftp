const assert = require("assert");
const parseMultilineResponse = require("../lib/ftp").utils.parseMultilineResponse;

const CRLF = "\r\n";
const LF = "\n";

describe("Parse multiline response", function() {
    const tests = [
        {
            title: "Single line",
            res: `200 A`,
            exp: [`200 A`]
        },
        {
            title: "Multiline",
            res: `150-A${CRLF}B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: [`150-A${LF}B${LF}150 C`, `200-D${LF}200 Done`]
        },
        {
            title: "Broken multiline",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: [`150-A${LF}160-B${LF}150 C`, `200-D${LF}200 Done`]
        },
        {
            title: "Multiline with indented tag",
            res: `150-A${CRLF} 150 B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: [`150-A${LF} 150 B${LF}150 C`, `200-D${LF}200 Done`]
        },
        {
            title: "Open-ended multiline",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D`,
            exp: [`150-A${LF}160-B${LF}150 C`, `200-D`]
        },               
    ];
    for (const test of tests) {
        it(test.title, function() {
            const actual = parseMultilineResponse(test.res);
            assert.deepEqual(actual, test.exp);
        });
    }
});
