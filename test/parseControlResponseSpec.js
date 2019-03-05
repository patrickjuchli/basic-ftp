const assert = require("assert");
const { parseControlResponse } = require("../dist/parseControlResponse");

const CRLF = "\r\n";
const LF = "\n";

describe("Parse multiline response", function() {
    const tests = [
        {
            title: "Single line",
            res: "200 A",
            exp: { messages: ["200 A"], rest: "" }
        },
        {
            title: "Single line with an extra CRLF",
            res: `200 A${CRLF}`,
            exp: { messages: ["200 A"], rest: "" }
        },
        {
            title: "Multiline: 1 response group",
            res: `150-A${CRLF}B${CRLF}150 C`,
            exp: { messages: [`150-A${LF}B${LF}150 C`], rest: "" }
        },
        {
            title: "Multiline: 2 response groups",
            res: `150-A${CRLF}B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { messages: [`150-A${LF}B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multiline: Invalid nested multiline",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { messages: [`150-A${LF}160-B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multiline: Closing tag but indent",
            res: `150-A${CRLF} 150 B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { messages: [`150-A${LF} 150 B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multline: No closing tag",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D`,
            exp: { messages: [`150-A${LF}160-B${LF}150 C`], rest: `200-D${LF}` }
        },
        {
            title: "Multiline: response group with no message on closing tag",
            res: `200-A${CRLF}200-B${CRLF}200-C${CRLF}200`,
            exp: { messages: [`200-A${LF}200-B${LF}200-C${LF}200`], rest: ""}
        },
        {
            title: "Single line without message",
            res: "200",
            exp: { messages: ["200"], rest: "" }
        }
    ];
    for (const test of tests) {
        it(test.title, function() {
            const actual = parseControlResponse(test.res);
            assert.deepEqual(actual, test.exp);
        });
    }
});
