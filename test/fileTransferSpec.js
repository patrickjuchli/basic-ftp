const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");
const fs = require("fs");

const SHORT_TEXT = "This is a short text to download"
const REMOTE_FILENAME = "file.txt"
const NEW_LOCAL_FILENAME = "file.txt"
const EXISTING_LOCAL_FILENAME = "existing.txt"
const TIMEOUT = 1000

describe("Download to a file", function() {

    let startAt = 0
    this.beforeEach(() => {
        fs.writeFileSync(EXISTING_LOCAL_FILENAME, "content");

        this.payload = SHORT_TEXT
        this.client = new Client(TIMEOUT)
        this.server = new MockFtpServer()
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => {
                    this.server.dataConn.write(this.payload.substring(startAt))
                    this.server.dataConn.end()
                })
                return arg === REMOTE_FILENAME ? "150 Ready to download" : "500 Wrong filename"
            },
            "rest": ({arg}) => {
                startAt = parseInt(arg, 10)
                return "350 Restarting"
            }
        })
        return this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
    })

    this.afterEach(() => {
        try { fs.unlinkSync(NEW_LOCAL_FILENAME) } catch {}
        try { fs.unlinkSync(EXISTING_LOCAL_FILENAME) } catch {}
        this.client.close()
        this.server.close()
    })

    it("can download to a new, not yet existing file", async () => {
        await this.client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME)
        const content = fs.readFileSync(NEW_LOCAL_FILENAME, "utf-8")
        assert.equal(content, SHORT_TEXT)
    })

    it("truncates existing file with startAt=0", async () => {
        await this.client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME)
        const content = fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8")
        assert.equal(content, SHORT_TEXT)
    })

    it("appends to existing file with start>0", async () => {
        const startAt = 4
        await this.client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME, startAt)
        const content = fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8")
        assert.equal(content, "cont" + SHORT_TEXT.substring(startAt))
    })

    it("raises an error if appending to non-existing file", async () => {
        return assert.rejects(() => this.client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME, 666), {
            code: "ENOENT"
        })
    })

    it("removes a file on error and if not appending", async () => {
        this.server.addHandlers({
            "pasv": () => {
                assert.equal(fs.existsSync(NEW_LOCAL_FILENAME), true, "File created right after method call")
                return "500 Unforseen error"
            }
        })
        return assert.rejects(() => this.client.downloadTo(NEW_LOCAL_FILENAME, REMOTE_FILENAME)).then(() => {
            assert.equal(fs.existsSync(NEW_LOCAL_FILENAME), false, "Empty file removed after error")
        })
    })

    it("does not remove a file on error if appending", async () => {
        this.server.addHandlers({
            "pasv": () => {
                assert.equal(fs.existsSync(EXISTING_LOCAL_FILENAME), true, "File exists")
                return "500 Unforseen error"
            }
        })
        return assert.rejects(() => this.client.downloadTo(EXISTING_LOCAL_FILENAME, REMOTE_FILENAME, 4)).then(() => {
            assert.equal(fs.readFileSync(EXISTING_LOCAL_FILENAME, "utf-8"), "content", "File untouched after error")
        })
    })
})
