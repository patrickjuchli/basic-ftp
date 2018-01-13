const assert = require("assert");
const groupControlResponse = require("../lib/ftp").utils.groupControlResponse;

const CRLF = "\r\n";
const LF = "\n";

describe("Parse multiline response", function() {
    const tests = [
        {
            title: "Single line",
            res: `200 A`,
            exp: { groups: [`200 A`], rest: "" }
        },
        {
            title: "Multiline: 2 response groups",
            res: `150-A${CRLF}B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { groups: [`150-A${LF}B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multiline: Invalid nested multiline",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { groups: [`150-A${LF}160-B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multiline: Closing tag but indent",
            res: `150-A${CRLF} 150 B${CRLF}150 C${CRLF}200-D${CRLF}200 Done`,
            exp: { groups: [`150-A${LF} 150 B${LF}150 C`, `200-D${LF}200 Done`], rest: "" }
        },
        {
            title: "Multline: No closing tag",
            res: `150-A${CRLF}160-B${CRLF}150 C${CRLF}200-D`,
            exp: { groups: [`150-A${LF}160-B${LF}150 C`], rest: `200-D` }
        },               
    ];
    for (const test of tests) {
        it(test.title, function() {
            const actual = groupControlResponse(test.res);
            assert.deepEqual(actual, test.exp);
        });
    }
});
