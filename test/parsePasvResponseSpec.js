const assert = require("assert");
const { parseIPv4PasvResponse, parseIPv6EpsvResponse } = require("../dist/Client");

describe("Parse passive transfer setup response", function() {

    it("can parse PASV", function() {
        const result = parseIPv4PasvResponse("227 Entering Passive Mode (192,168,1,100,10,229)");
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 2789, "Port");
    });

    it("throws exception if can't parse PASV", function() {
        assert.throws(() => {
            parseIPv4PasvResponse("227 Entering Passive Mode (192,168,1,100,229)");
        }, new Error("Can't parse response to 'PASV': 227 Entering Passive Mode (192,168,1,100,229)"))
    })

    it("can parse EPSV", function() {
        const port = parseIPv6EpsvResponse("229 Entering Extended Passive Mode (|||6446|)")
        assert.equal(port, 6446)
    })

    it("can parse EPSV from IBM i (OS/400) ", function() {
        const port = parseIPv6EpsvResponse("229 Entering Extended Passive Mode (!!!6446!)")
        assert.equal(port, 6446)
    })

    it("throws exception if can't parse EPSV", function() {
        assert.throws(() => {
            parseIPv6EpsvResponse("229 Entering Extended Passive Mode (!!6446!)")
        }, new Error("Can't parse response to 'EPSV': 229 Entering Extended Passive Mode (!!6446!)"))
    })
});
