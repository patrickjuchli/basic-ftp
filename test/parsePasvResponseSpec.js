const assert = require("assert");
const parseIPv4 = require("../lib/ftp").utils.parseIPv4PasvResponse;

describe("Parse PASV response", function() {
    it("can parse IPv4", function() {
        const result = parseIPv4("227 Entering Passive Mode (192,168,1,100,10,229)");
        assert.equal(result.host, "192.168.1.100", "Host");
        assert.equal(result.port, 2789, "Port")
    });
});
