const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");
const { Writable } = require("stream")
const fs = require("fs");
const mock = require("mock-fs")

const SHORT_TEXT = "This is a short text to download"
const REMOTE_FILENAME = "file.txt"
const NEW_LOCAL_FILENAME = "file.txt"
const EXISTING_LOCAL_FILENAME = "existing.txt"
const TIMEOUT = 1000

async function prep(payload = SHORT_TEXT) {
    const server = new MockFtpServer()
    const client = new Client(TIMEOUT)
    await client.access({
        port: server.ctrlAddress.port,
        user: "test",
        password: "test"
    })
    let startAt = 0
    server.addHandlers({
        "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
        "retr": ({arg}) => {
            setTimeout(() => {
                server.dataConn.write(payload.substring(startAt))
                server.dataConn.end()
            })
            return arg === REMOTE_FILENAME ? "150 Ready to download" : "500 Wrong filename"
        },
        "rest": ({arg}) => {
            startAt = parseInt(arg, 10)
            return "350 Restarting"
        }
    })
    return { client, server }
}

describe("Download to a file", function() {
    // Mock the filesystem
    this.beforeEach(() => mock({
        [EXISTING_LOCAL_FILENAME]: "content"
    }));
    this.afterEach(mock.restore);

    it("can download to a new, not yet existing file", async () => {
        const { client } = await prep()
        await client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME)
        const content = fs.readFileSync(NEW_LOCAL_FILENAME, "utf-8")
        assert.equal(content, SHORT_TEXT)
    })

    it("truncates existing file with startAt=0", async function() {
        const { client } = await prep()
        await client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME)
        const content = fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8")
        assert.equal(content, SHORT_TEXT)
    })

    it("appends to existing file with start>0", async function() {
        const { client } = await prep()
        const startAt = 4
        await client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME, startAt)
        const content = fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8")
        assert.equal(content, "cont" + SHORT_TEXT.substring(startAt))
    })

    it("raises an error if appending to non-existing file", async () => {
        const { client } = await prep()
        return assert.rejects(() => client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME, 666), {
            code: "ENOENT"
        })
    })

    it("removes a file on error and if not appending", async () => {
        const { client, server } = await prep()
        server.addHandlers({
            "pasv": () => {
                assert.equal(fs.existsSync(NEW_LOCAL_FILENAME), true, "File created right after method call")
                return "500 Unforseen error"
            }
        })
        return assert.rejects(() => client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME), {
            code: 500
        }).then(() => {
            assert.equal(fs.existsSync(NEW_LOCAL_FILENAME), false, "Empty file removed after error")
        })
    })

    it("does not remove a file on error if appending", async () => {
        const { client, server } = await prep()
        server.addHandlers({
            "pasv": () => {
                assert.equal(fs.existsSync(EXISTING_LOCAL_FILENAME), true, "File exists")
                return "500 Unforseen error"
            }
        })
        return assert.rejects(() => client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME, 4), {
            code: 500
        }).then(() => {
            assert.equal(fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8"), "content", "File untouched after error")
        })
    })
})
