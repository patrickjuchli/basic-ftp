const { describe, it, beforeEach, afterEach } = require("node:test");
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

describe("Download to stream", () => {

    let payload, client, server;

    beforeEach(() => {
        payload = SHORT_TEXT
        client = new Client(TIMEOUT)
        server = new MockFtpServer()
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => {
                    server.dataConn.write(payload)
                    server.dataConn.end()
                })
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        return client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
    })

    afterEach(() => {
        client.close()
        server.close()
    })

    const testPayloads = [ EMPTY_TEXT, SHORT_TEXT, MEDIUM_TEXT, LONG_TEXT ]
    for (const p of testPayloads) {
        it(`can download ${p.length} bytes`, async () => {
            payload = p
            const buf = new StringWriter()
            await client.downloadTo(buf, FILENAME)
            assert.deepEqual(buf.getText("utf-8"), p)
        })
    }

    // RFC 959 lists "125" and "150" as alternative preliminary replies to RETR, so only one of
    // them should arrive. Guard against it anyway: starting the transfer for each preliminary
    // reply pipes the data connection into the destination multiple times, which corrupts the
    // result without reporting an error.
    it("transfers only once when the server sends repeated preliminary replies", async () => {
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": () => {
                setTimeout(() => {
                    server.dataConn.write(MEDIUM_TEXT)
                    server.dataConn.end()
                })
                return "125 Data connection already open\r\n150 Ready to download"
            }
        })
        const buf = new StringWriter()
        await client.downloadTo(buf, FILENAME)
        assert.deepEqual(buf.getText("utf-8"), MEDIUM_TEXT)
    })

    it("handles late destination stream error", async () => {
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => server.dataConn.write("one..."))
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const writable = new Writable()
        writable._write = (chunk, enc, cb) => {
            cb()
            writable.destroy(new Error("local disk full"))
        }
        return assert.rejects(() => client.downloadTo(writable, FILENAME), {
            message: "local disk full"
        })
    })

    it("handles late destination stream closing", async () => {
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                setTimeout(() => server.dataConn.write("one..."))
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const writable = new Writable()
        writable._write = (chunk, enc, cb) => {
            cb()
            // Close destination stream after it received the first chunk
            writable.emit("close")
        }
        return assert.rejects(() => client.downloadTo(writable, FILENAME), err => {
            // Error message can be "Premature close" or "Premature close (data socket)"
            assert.match(err.message, /Premature close/)
            return true
        })
    })

    it("handles data arriving before control announcing start", async () => {
        const p = SHORT_TEXT
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                // Sending data and closing stream..
                server.dataConn.write(p)
                server.dataConn.end()
                // ..before announcing it
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const buf = new StringWriter()
        await client.downloadTo(buf, FILENAME)
        assert.deepEqual(buf.getText("utf-8"), p)
    })

    it("relays FTP error response even if data transmitted completely", async () => {
        payload = SHORT_TEXT
        server.didCloseDataConn = () => server.writeCtrl("500 Error")
        const buf = new StringWriter()
        return assert.rejects(() => client.downloadTo(buf, FILENAME), {
            message: "500 Error"
        }).then(() => {
            assert.deepEqual(buf.getText("utf-8"), payload)
        })
    })

    it("ignores error thrown on data socket after transfer completed successfully", async () => {
        let dataSocket
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "retr": ({arg}) => {
                dataSocket = client.ftp.dataSocket
                server.dataConn.end("some data")
                return arg === FILENAME ? "150 Ready to download" : "500 Wrong filename"
            }
        })
        const buf = new StringWriter()
        await client.downloadTo(buf, FILENAME)
        dataSocket.destroy(new Error("Error that should be ignored because task has completed successfully"))
    })

    it.todo("stops tracking timeout after failure")
    it.todo("can get a directory listing")
    it.todo("uses control host IP if suggested data connection IP using PASV is private")
    it.todo("can download using TLS")
})
