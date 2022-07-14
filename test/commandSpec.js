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

async function prep() {
    const server = new MockFtpServer()
    const client = new Client(1000)
    await client.access({
        port: server.ctrlAddress.port,
        user: "test",
        password: "test"
    })
    return { server, client }
}

describe("Simple commands", function() {

    it("can get a file size", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "size": ({arg}) => arg === "file.txt" ? "213 6666" : "400 File not found"  
        })
        return client.size("file.txt").then(result => {
            assert.strictEqual(result, 6666)
        })
    })

    it("can get last modified time", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "mdtm": ({arg}) => arg === "file.txt" ? "213 19951217032400" : "400 File not found"
        })
        return client.lastMod("file.txt").then(result => {
            assert.deepEqual(result, new Date("1995-12-17T03:24:00+0000"))
        }) 
    })

    it("can get features", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "feat": () => FEAT_REPLY
        })
        return client.features().then(result => {
            assert.deepEqual(result, new Map([["MLST", "size*;create"], ["SIZE", ""]]))
        })         
    })

    it("can handle no features", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "feat": () => NO_FEAT_REPLY
        })
        return client.features().then(result => {
            assert.deepEqual(result, new Map())
        })         
    })

    it("returns empty feature set when server sends error", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "test": () => "200 OK"
        })
        return client.send("TEST").then(result => {
            assert.deepEqual(result, { code: 200, message: "200 OK" })
        })         
    })

    it("sending command handles error", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "test": () => "500 Command unknown"
        })
        return assert.rejects(() => client.send("TEST"), {
            name: "FTPError",
            message: "500 Command unknown"
        })       
    })

    it("can ignore error response ", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "test": () => "500 Command unknown"
        })
        return assert.doesNotReject(() => client.sendIgnoringError("TEST"))       
    })

    it("throws if connection error even if ignoring errors has been requested", async () => {
        const { server, client } = await prep()
        server.addHandlers({
            "test": () => server.ctrlConn.destroy()
        })
        return assert.rejects(() => client.send("TEST"), {
            name: "Error",
            message: "Server sent FIN packet unexpectedly, closing connection."
        })       
    })

    // TODO test all other simple commands
})