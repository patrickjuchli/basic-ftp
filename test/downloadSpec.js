const assert = require("assert");
const { Client } = require("../dist");
const { StringWriter } = require("../dist/StringWriter");
const MockFtpServer = require("./MockFtpServer");
const { Writable } = require("stream")
const fs = require("fs");

const FILENAME = "file.txt"
const TIMEOUT = 1000
const EMPTY_TEXT = ""
const SHORT_TEXT = "Short"
const MEDIUM_TEXT = "s".repeat(45017) // https://github.com/patrickjuchli/basic-ftp/issues/205
const LONG_TEXT = `Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich
in seinem Bett zu einem ungeheueren Ungeziefer verwandelt. Er lag auf seinem
panzerartig harten Rücken und sah, wenn er den Kopf ein wenig hob, seinen
gewölbten, braunen, von bogenförmigen Versteifungen geteilten Bauch, auf dessen
Höhe sich die Bettdecke, zum gänzlichen Niedergleiten bereit, kaum noch erhalten
konnte. Seine vielen, im Vergleich zu seinem sonstigen Umfang kläglich dünnen
Beine flimmerten ihm hilflos vor den Augen.`.repeat(2000)

describe("Download to stream", function() {

    this.beforeEach(() => {
        this.payload = SHORT_TEXT
        this.client = new Client(TIMEOUT)
        this.server = new MockFtpServer()
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => {
                    this.server.dataConn.write(this.payload)
                    this.server.dataConn.end()
                })
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
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

    const testPayloads = [ EMPTY_TEXT, SHORT_TEXT, MEDIUM_TEXT, LONG_TEXT ]
    for (const payload of testPayloads) {
        it(`can download ${payload.length} bytes`, async () => {
            this.payload = payload
            const buf = new StringWriter()
            await this.client.downloadTo(buf, FILENAME)
            assert.deepEqual(buf.getText("utf-8"), payload)
        })
    }
    
    it("handles early destination stream error", () => {
        return this.client.downloadTo(fs.createWriteStream("test"), "test.json")
        .then(() => assert.fail("exception expected"))
        .catch(err => {
            const expected = "EISDIR: illegal operation on a directory, open 'test'"
            assert(err.message.includes(expected), `${err.message} should include "${expected}"`)
        })
    })

    it("handles late destination stream error", async () => {
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => this.server.dataConn.write("one..."))
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const writable = new Writable()
        writable._write = (chunk, enc, cb) => {
            cb()
            writable.destroy(new Error("local disk full"))
        }
        return assert.rejects(() => this.client.downloadTo(writable, FILENAME), {
            message: "local disk full"
        })
    })

    it("handles late destination stream closing", async () => {
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => this.server.dataConn.write("one..."))
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const writable = new Writable()
        writable._write = (chunk, enc, cb) => {
            cb()
            // Close destination stream after it received the first chunk
            writable.emit("close")
        }
        return assert.rejects(() => this.client.downloadTo(writable, FILENAME), err => {
            // Error message can be "Premature close" or "Premature close (data socket)"
            assert.match(err.message, /Premature close/)
            return true
        })
    })

    it("handles data arriving before control announcing start", async () => {
        const payload = SHORT_TEXT
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                // Sending data and closing stream..
                this.server.dataConn.write(payload)
                this.server.dataConn.end()
                // ..before announcing it
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const buf = new StringWriter()
        await this.client.downloadTo(buf, FILENAME)
        assert.deepEqual(buf.getText("utf-8"), payload)
    })

    it("relays FTP error response even if data transmitted completely", async () => {
        this.payload = SHORT_TEXT
        this.server.didCloseDataConn = () => this.server.writeCtrl("500 Error")
        const buf = new StringWriter()
        return assert.rejects(() => this.client.downloadTo(buf, FILENAME), {
            message: "500 Error"
        }).then(() => {
            assert.deepEqual(buf.getText("utf-8"), this.payload)
        })
    })

    it("ignores error thrown on data socket after transfer completed successfully", async () => {
        let dataSocket
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                dataSocket = this.client.ftp.dataSocket
                this.server.dataConn.end("some data")
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const buf = new StringWriter()
        await this.client.downloadTo(buf, FILENAME)
        dataSocket.destroy(new Error("Error that should be ignored because task has completed successfully"))
    })

    it("stops tracking timeout after failure")
    it("can get a directory listing")
    it("uses control host IP if suggested data connection IP using PASV is private")
    it("can download using TLS")
})
