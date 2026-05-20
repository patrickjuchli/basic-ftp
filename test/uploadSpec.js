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
        client.ftp.timeout = 100
        server.addHandlers({
            "pasv": () => "227 Entering Passive Mode (192,168,1,100,10,229)"
        })
        return assert.rejects(() => client.uploadFrom(getReadable(), "NAME.TXT"), {
            name: "Error"
            // Error can be ECONNRESET or a Timeout, both report under the same Error name.
        })
    })

    it(`switches correctly between sockets to track timeout during transfer`, () => {
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
            assert.strictEqual(client.ftp.dataSocket.timeout, TIMEOUT, "did start transfer (data)");
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

    it.todo("can upload with localStart/localEndInclusive")
    it.todo("can append")
    it.todo("can append with localStart/localEndInclusive")
    it.todo("can upload using TLS")
})
