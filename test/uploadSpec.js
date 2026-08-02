const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");
const { Readable } = require("stream")
const fs = require("fs");

const EMPTY_TEXT = ""
const SHORT_TEXT = "Short"
const LONG_TEXT = "s".repeat(45017) // https://github.com/patrickjuchli/basic-ftp/issues/205
const VERY_LONG_TEXT = `Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich
in seinem Bett zu einem ungeheueren Ungeziefer verwandelt. Er lag auf seinem
panzerartig harten Rücken und sah, wenn er den Kopf ein wenig hob, seinen
gewölbten, braunen, von bogenförmigen Versteifungen geteilten Bauch, auf dessen
Höhe sich die Bettdecke, zum gänzlichen Niedergleiten bereit, kaum noch erhalten
konnte. Seine vielen, im Vergleich zu seinem sonstigen Umfang kläglich dünnen
Beine flimmerten ihm hilflos vor den Augen.`.repeat(2000)

const FILENAME = "file.txt"
const TIMEOUT = 1000
// Used where a test has to wait for a timeout to happen, or to not happen.
const SHORT_TIMEOUT = 100

function getReadable(p = SHORT_TEXT) {
    const readable = new Readable()
    readable.push(p)
    readable.push(null)
    return readable
}

describe("Upload", () => {

    let client, server;

    beforeEach(() => {
        client = new Client(TIMEOUT)
        server = new MockFtpServer()
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "stor": ({arg}) => arg === FILENAME ? "150 Ready to upload" : "500 Wrong filename"
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

    const testPayloads = [ EMPTY_TEXT, SHORT_TEXT, LONG_TEXT, VERY_LONG_TEXT ]
    for (const p of testPayloads) {
        it(`can upload ${p.length} bytes`, async () => {
            const readable = getReadable(p)
            const ret = await client.uploadFrom(readable, FILENAME)
            assert.deepEqual(server.uploadedData, Buffer.from(p, "utf-8"))
            return ret
        })
    }

    it("always tries EPSV first, then PASV", async () => {
        const strategies = []
        server.addHandlers({
            "epsv": () => {
                strategies.push("epsv")
                return "500 Command unknown"
            },
            "pasv": () => {
                strategies.push("pasv")
                return "500 Command unknown"
            }
        })
        return assert.rejects(() => client.uploadFrom(getReadable(), "NAME.TXT")).then(() => {
            assert.deepEqual(strategies, ["epsv", "pasv"])
        })
    })

    it("throws on unknown PASV command", async () => {
        server.addHandlers({
            "pasv": () => "500 Command unknown"
        })
        return assert.rejects(() => client.uploadFrom(getReadable(), "NAME.TXT"), {
            name: "Error",
            message: "None of the available transfer strategies work. Last error response was 'FTPError: 500 Command unknown'."
        })
    })

    it("throws on wrong PASV format", async () => {
        server.addHandlers({
            "pasv": () => "227 Missing IP"
        })
        return assert.rejects(() => client.uploadFrom(getReadable(), "NAME.TXT"), {
            name: "Error",
            message: "None of the available transfer strategies work. Last error response was 'Error: Can't parse response to 'PASV': 227 Missing IP'."
        })
    })

    it("throws if data connection can't be opened", () => {
        client.ftp.timeout = SHORT_TIMEOUT
        server.addHandlers({
            "pasv": () => "227 Entering Passive Mode (192,168,1,100,10,229)"
        })
        return assert.rejects(() => client.uploadFrom(getReadable(), "NAME.TXT"), {
            name: "Error"
            // Error can be ECONNRESET or a Timeout, both report under the same Error name.
        })
    })

    // The control connection tracks its timeout only while it's the one we're waiting for. The
    // data connection never gets an inactivity timeout of its own: it would also fire while a
    // slow local stream is holding up the transfer. TransferWatchdog watches it instead.
    it(`stops tracking timeouts on both sockets during transfer`, () => {
        const readable = new Readable()
        readable._read = () => {}
        readable.push(SHORT_TEXT)
        assert.strictEqual(client.ftp.socket.timeout, 0, "before task (control)");
        assert.strictEqual(client.ftp.dataSocket, undefined, "before task (data)");
        server.addHandlers({
            "pasv": () => {
                assert.strictEqual(client.ftp.socket.timeout, TIMEOUT, "before PASV (control)");
                return `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`
            },
            "stor": ({arg}) => {
                assert.strictEqual(client.ftp.socket.timeout, TIMEOUT, "before STOR (control)");
                assert.strictEqual(client.ftp.dataSocket.timeout, 0, "before STOR (data)");
                return arg === FILENAME ? "150 Ready to upload" : "500 Wrong filename"
            }
        })
        server.didStartTransfer = () => {
            assert.strictEqual(client.ftp.socket.timeout, 0, "did start transfer (control)");
            assert.strictEqual(client.ftp.dataSocket.timeout, 0, "did start transfer (data)");
            readable.push(SHORT_TEXT)
            readable.push(null)
        }
        server.didCloseDataConn = () => {
            assert.strictEqual(client.ftp.socket.timeout, TIMEOUT, "did close data connection (control)");
            assert.strictEqual(client.ftp.dataSocket.timeout, 0, "did close data connection (data)");
        }
        return client.uploadFrom(readable, FILENAME).then(() => {
            assert.strictEqual(client.ftp.socket.timeout, 0, "after task (control)");
            assert.strictEqual(client.ftp.dataSocket, undefined, "after task (data)");
        })
    })

    // A source that is slow to provide data is not a broken connection.
    it("doesn't time out while a slow source is holding up the transfer", async () => {
        client.ftp.timeout = SHORT_TIMEOUT
        const source = new Readable()
        source._read = () => {}
        source.push("the beginning...")
        setTimeout(() => {
            source.push("...and the end")
            source.push(null)
        }, 5 * SHORT_TIMEOUT)
        await client.uploadFrom(source, FILENAME)
        assert.deepEqual(server.uploadedData, Buffer.from("the beginning......and the end", "utf-8"))
    })

    it("times out if the server stops accepting data", async () => {
        client.ftp.timeout = SHORT_TIMEOUT
        // Enough data that it can't all disappear into the buffers of a server that isn't reading.
        const source = getReadable("s".repeat(16 * 1000 * 1000))
        server.didStartTransfer = () => server.dataConn.pause()
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            message: "Timeout (data socket)"
        })
    })

    it("handles early error from source stream", async () => {
        const source = new Readable()
        source.destroy(new Error("Closing with specific ERROR"))
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            name: "Error",
            message: "None of the available transfer strategies work. Last error response was 'Error: Client is closed because Closing with specific ERROR'."
        })
    })

    it("handles late error from source stream", async () => {
        const source = new Readable()
        source._read = () => {}
        source.push("the beginning...")
        server.didStartTransfer = () => {
            source.destroy(new Error("BOOM during transfer"))
        }
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            name: "Error",
            message: "BOOM during transfer"
        })
    })

    it("handles FTP errors during transfer", () => {
        const source = new Readable()
        source._read = () => {}
        source.push("the beginning...")
        server.didStartTransfer = () => {
            server.writeCtrl("500 Server reports some error during transfer")
        }
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            name: "FTPError",
            message: "500 Server reports some error during transfer"
        })
    })

    // RFC 959 lists "125" and "150" as alternative preliminary replies to STOR, so only one of
    // them should arrive. Guard against it anyway: starting the transfer for each preliminary
    // reply pipes the source into the data connection multiple times, which corrupts the remote
    // file without reporting an error.
    const repeatedPreliminaries = [
        ["125 Data connection already open", "150 Ready to upload"],
        ["150 Ready to upload", "150 Ready to upload"]
    ]
    for (const replies of repeatedPreliminaries) {
        // Timeout so that a regression fails the test instead of stalling the whole run:
        // transferring twice leaves the source and the data connection in a state where
        // neither the transfer nor the control response ever completes.
        it(`transfers only once when the server sends "${replies.join(`", "`)}"`, { timeout: TIMEOUT * 5 }, async () => {
            server.addHandlers({
                "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
                "stor": () => replies.join("\r\n")
            })
            await client.uploadFrom(getReadable(LONG_TEXT), FILENAME)
            assert.deepEqual(server.uploadedData, Buffer.from(LONG_TEXT, "utf-8"))
        })
    }

    describe("from a local file", () => {

        const LOCAL_FILENAME = "upload-source.txt"
        // Position-sensitive content so that range uploads can't pass by accident.
        const LOCAL_CONTENT = "0123456789abcdefghij".repeat(2000)

        beforeEach(() => {
            fs.writeFileSync(LOCAL_FILENAME, LOCAL_CONTENT)
        })

        afterEach(() => {
            try { fs.unlinkSync(LOCAL_FILENAME) } catch { /* Already gone */ }
        })

        it("can upload a local file", async () => {
            await client.uploadFrom(LOCAL_FILENAME, FILENAME)
            assert.deepEqual(server.uploadedData, Buffer.from(LOCAL_CONTENT, "utf-8"))
        })

        it("can upload with localStart/localEndInclusive", async () => {
            await client.uploadFrom(LOCAL_FILENAME, FILENAME, { localStart: 10, localEndInclusive: 19 })
            assert.deepEqual(server.uploadedData, Buffer.from("abcdefghij", "utf-8"))
        })

        it("can upload with localEndInclusive beyond the end of the file", async () => {
            await client.uploadFrom(LOCAL_FILENAME, FILENAME, { localStart: 10, localEndInclusive: LOCAL_CONTENT.length + 1000 })
            assert.deepEqual(server.uploadedData, Buffer.from(LOCAL_CONTENT.slice(10), "utf-8"))
        })

        // Reading a local file that is modified during the transfer ends early or late. The
        // server can't detect this and confirms the transfer, so the client has to compare
        // what it read with what it expected to read.
        it("throws if the local file shrinks while being uploaded", async () => {
            const prepareTransfer = client.prepareTransfer
            client.prepareTransfer = ftp => {
                fs.truncateSync(LOCAL_FILENAME, 10)
                return prepareTransfer(ftp)
            }
            return assert.rejects(() => client.uploadFrom(LOCAL_FILENAME, FILENAME), {
                name: "Error",
                message: `Local file "${LOCAL_FILENAME}" changed while it was being uploaded to "${FILENAME}": expected to send ${LOCAL_CONTENT.length} bytes but sent 10. The remote file is incomplete.`
            })
        })

        it("throws if the local file grows while being uploaded", async () => {
            const prepareTransfer = client.prepareTransfer
            client.prepareTransfer = ftp => {
                fs.appendFileSync(LOCAL_FILENAME, "more")
                return prepareTransfer(ftp)
            }
            return assert.rejects(() => client.uploadFrom(LOCAL_FILENAME, FILENAME), {
                name: "Error",
                message: `Local file "${LOCAL_FILENAME}" changed while it was being uploaded to "${FILENAME}": expected to send ${LOCAL_CONTENT.length} bytes but sent ${LOCAL_CONTENT.length + 4}. The remote file is incomplete.`
            })
        })

        it("can upload an empty local file", async () => {
            fs.writeFileSync(LOCAL_FILENAME, "")
            await client.uploadFrom(LOCAL_FILENAME, FILENAME)
            assert.deepEqual(server.uploadedData, Buffer.alloc(0))
        })
    })

    it.todo("can append")
    it.todo("can append with localStart/localEndInclusive")
    it.todo("can upload using TLS")
})
