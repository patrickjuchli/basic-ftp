const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");

const FEAT_REPLY = `
211-Extensions supported:
 MLST size*;create
 SIZE
211 END
`;
const NO_FEAT_REPLY = `
211 No features
`;
const FILENAME = "file.txt"

describe("Simple commands", function() {

    this.beforeEach(() => {
        this.server = new MockFtpServer()
        this.client = new Client(1000)
        return this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
    })

    this.afterEach(() => {
        this.client.close()
        this.server.close()
    })

    it("can get a file size", () => {
        this.server.addHandlers({
            "size": ({arg}) => arg === "file.txt" ? "213 6666" : "400 File not found"  
        })
        return this.client.size("file.txt").then(result => {
            assert.strictEqual(result, 6666)
        })
    })

    it("can get last modified time", () => {
        this.server.addHandlers({
            "mdtm": ({arg}) => arg === "file.txt" ? "213 19951217032400" : "400 File not found"
        })
        return this.client.lastMod("file.txt").then(result => {
            assert.deepEqual(result, new Date("1995-12-17T03:24:00+0000"))
        }) 
    })

    it("can get features", () => {
        this.server.addHandlers({
            "feat": () => FEAT_REPLY
        })
        return this.client.features().then(result => {
            assert.deepEqual(result, new Map([["MLST", "size*;create"], ["SIZE", ""]]))
        })         
    })

    it("can handle no features", () => {
        this.server.addHandlers({
            "feat": () => NO_FEAT_REPLY
        })
        return this.client.features().then(result => {
            assert.deepEqual(result, new Map())
        })         
    })

    it("returns empty feature set when server sends error", () => {
        this.server.addHandlers({
            "test": () => "200 OK"
        })
        return this.client.send("TEST").then(result => {
            assert.deepEqual(result, { code: 200, message: "200 OK" })
        })         
    })

    it("sending command handles error", () => {
        this.server.addHandlers({
            "test": () => "500 Command unknown"
        })
        return assert.rejects(() => this.client.send("TEST"), {
            name: "FTPError",
            message: "500 Command unknown"
        })       
    })

    it("can ignore error response ", () => {
        this.server.addHandlers({
            "test": () => "500 Command unknown"
        })
        return assert.doesNotReject(() => this.client.sendIgnoringError("TEST"))       
    })

    it("throws if connection error even if ignoring errors has been requested", () => {
        this.server.addHandlers({
            "test": () => this.server.ctrlConn.destroy()
        })
        return assert.rejects(() => this.client.send("TEST"), {
            name: "Error",
            message: "Server sent FIN packet unexpectedly, closing connection."
        })       
    })

    it("can rename a file", () => {
        this.server.addHandlers({
            "rnfr": ({arg}) => arg === "old.txt" ? "350 Accepted" : "500 File not found",
            "rnto": ({arg}) => arg === "new.txt" ? "200 Renamed" : "500 File not found",
        })
        return this.client.rename("old.txt", "new.txt").then(result => {
            assert.deepEqual(result, { code: 200, message: "200 Renamed" })
        })
    })
        
    it("can handle leading whitespace in a filename", () => {
        this.server.addHandlers({
            "pwd": () => `257 "/this/that"`
        })
        return this.client.protectWhitespace("  file.txt").then(result => {
            assert.strictEqual(result, "/this/that/  file.txt")
        })
    })

    it("can handle leading whitespace in relative path", () => {
        this.server.addHandlers({
            "pwd": () => `257 "/this/that"`
        })
        return this.client.protectWhitespace(" a/b").then(result => {
            assert.strictEqual(result, "/this/that/ a/b")
        })
    })

    it("can remove a file")
    it("can change directory")
    it("can get the current working directory")
})