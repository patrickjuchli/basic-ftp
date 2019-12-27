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
        const w = new StringWriter()
        w.write(Buffer.from([0xE2, 0x82]))
        w.end(Buffer.from([0xAC]))
        assert.equal(w.getText("utf-8"), "€")
    })
});