const assert = require("assert");
const { StringWriter } = require("../dist/StringWriter")

describe("StringWriter", function() {
    it("can run write string result", function() {
        const w = new StringWriter()
        w.write(Buffer.from("hello"))
        w.write(Buffer.from("world"))
        w.end()
        assert.equal(w.getText("utf-8"), "helloworld")
    })

    it("can handle chunked multi-byte unicode codepoints", function() {
        const euro = [[0xE2, 0x82], [0xAC]].map(Buffer.from);
        const w = new StringWriter()
        w.write(euro[0])
        w.end(euro[1])
        assert.equal(w.getText("utf-8"), "€")
    })
});