const assert = require("assert");
const { StringWriter } = require("../dist/StringWriter")

describe("StringWriter", function() {
    it("can run write string result", function() {
        const w = new StringWriter(10000)
        w.write(Buffer.from("hello"))
        w.write(Buffer.from("world"))
        w.end()
        assert.equal(w.getText("utf-8"), "helloworld")
    })

    it("can handle chunked multi-byte unicode codepoints", function() {
        const w = new StringWriter(10000)
        w.write(Buffer.from([0xE2, 0x82]))
        w.end(Buffer.from([0xAC]))
        assert.equal(w.getText("utf-8"), "€")
    })

    it("fails if out of bounds", function(done) {
        const w = new StringWriter(10)
        w.once("error", (err) => {
            assert.match(err.message, /Maximum bytes exceeded/i)
            done()
        })
        w.write(Buffer.from("hello"))
        w.write(Buffer.from("worldworldworld"))
    })
});