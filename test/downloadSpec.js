const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const { Client } = require("../dist");
const { StringWriter } = require("../dist/StringWriter");
const MockFtpServer = require("./MockFtpServer");
const { Writable } = require("stream")
const fs = require("fs");

const FILENAME = "file.txt"
const TIMEOUT = 1000
// Used where a test has to wait for a timeout to happen, or to not happen.
const SHORT_TIMEOUT = 100
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

    // A destination that is slow to accept data is not a broken connection. Timing out on it
    // aborts a healthy transfer and truncates whatever the destination received so far.
    it("doesn't time out while a slow destination is holding up the transfer", async () => {
        payload = "s".repeat(1000 * 1000)
        client.ftp.timeout = SHORT_TIMEOUT
        let received = 0
        let blocking = false
        let bytesReadWhileBlocked = 0
        const destination = new Writable({
            highWaterMark: 1,
            write(chunk, enc, cb) {
                received += chunk.length
                if (blocking) {
                    cb()
                    return
                }
                blocking = true
                setTimeout(() => {
                    bytesReadWhileBlocked = client.ftp.dataSocket.bytesRead
                    cb()
                }, 5 * SHORT_TIMEOUT)
            }
        })
        await client.downloadTo(destination, FILENAME)
        assert.strictEqual(received, payload.length, "received all data")
        assert.ok(bytesReadWhileBlocked < payload.length,
            `transfer was really held up, read ${bytesReadWhileBlocked} of ${payload.length} bytes while blocked`)
    })

    it("times out if the server stops sending", async () => {
        client.ftp.timeout = SHORT_TIMEOUT
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            // Send something, then go silent without ever closing the data connection.
            "retr": () => {
                setTimeout(() => server.dataConn.write("the beginning..."))
                return "150 Ready to download"
            }
        })
        return assert.rejects(() => client.downloadTo(new StringWriter(), FILENAME), {
            message: "Timeout (data socket)"
        })
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

    it("stops tracking timeout after failure", async () => {
        client.ftp.timeout = SHORT_TIMEOUT
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            // Fail while the data connection is transferring.
            "retr": () => {
                setTimeout(() => {
                    server.dataConn.write("the beginning...")
                    server.writeCtrl("500 Something went wrong")
                })
                return "150 Ready to download"
            },
            "noop": () => "200 OK"
        })
        await assert.rejects(() => client.downloadTo(new StringWriter(), FILENAME), {
            message: "500 Something went wrong"
        })
        assert.strictEqual(client.ftp.socket.timeout, 0, "control socket stopped tracking")
        // Nothing may be left watching the failed transfer: it would report a timeout later on,
        // taking down whatever the client is doing by then.
        await client.access({ port: server.ctrlAddress.port, user: "test", password: "test" })
        await new Promise(resolve => setTimeout(resolve, 3 * SHORT_TIMEOUT))
        assert.strictEqual(client.closed, false, "client still connected after being idle")
        await client.send("NOOP")
    })

    it.todo("can get a directory listing")
    it.todo("uses control host IP if suggested data connection IP using PASV is private")
    it.todo("can download using TLS")
})
