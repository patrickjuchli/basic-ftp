const { describe, it } = require("node:test");
const assert = require("assert");
const { parsePasvResponse, parseEpsvResponse } = require("../dist/transfer");

describe("Parse passive transfer setup response", function() {

    it("can parse PASV", function() {
        const result = parsePasvResponse("227 Entering Passive Mode (192,168,1,100,10,229)");
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 2789, "Port");
    });

    it("throws exception if can't parse PASV", function() {
        assert.throws(() => {
            parsePasvResponse("227 Entering Passive Mode (192,168,1,100,229)");
        }, new Error("Can't parse response to 'PASV': 227 Entering Passive Mode (192,168,1,100,229)"))
    })

    it("can parse PASV without parentheses", function() {
        const result = parsePasvResponse("227 Entering Passive Mode 192,168,1,100,10,229");
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 2789, "Port");
    });

    it("can parse PASV with negative numbers", function() {
        const result = parsePasvResponse("227 Entering Passive Mode (192,168,1,100,-1,-27)");
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 65509, "Port");
    });

    // A response comes from a remote server, parsing it must not let that server block the event loop.
    it("rejects a long PASV number without commas quickly", function() {
        const start = Date.now();
        assert.throws(() => parsePasvResponse("227 " + "1".repeat(64 * 1024)), /Can't parse response to 'PASV'/);
        const duration = Date.now() - start;
        assert.ok(duration < 1000, `Parsing took ${duration}ms, expected less than 1000ms`);
    });

    it("parses PASV following a long number quickly", function() {
        const start = Date.now();
        const result = parsePasvResponse("227 " + "1".repeat(64 * 1024) + " (192,168,1,100,10,229)");
        const duration = Date.now() - start;
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 2789, "Port");
        assert.ok(duration < 1000, `Parsing took ${duration}ms, expected less than 1000ms`);
    });

    it("can parse EPSV", function() {
        const port = parseEpsvResponse("229 Entering Extended Passive Mode (|||6446|)")
        assert.equal(port, 6446)
    })

    it("can parse EPSV from IBM i (OS/400) ", function() {
        const port = parseEpsvResponse("229 Entering Extended Passive Mode (!!!6446!)")
        assert.equal(port, 6446)
    })

    it("throws exception if can't parse EPSV", function() {
        assert.throws(() => {
            parseEpsvResponse("229 Entering Extended Passive Mode (!!6446!)")
        }, new Error("Can't parse response to 'EPSV': 229 Entering Extended Passive Mode (!!6446!)"))
    })
});
