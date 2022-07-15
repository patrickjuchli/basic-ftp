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

async function prep(payload = SHORT_TEXT) {
    const server = new MockFtpServer()
    const client = new Client(TIMEOUT)
    const readable = new Readable()
    readable.push(payload)
    readable.push(null)
    await client.access({
        port: server.ctrlAddress.port,
        user: "test",
        password: "test"
    })
    server.addHandlers({
        "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
        "stor": ({arg}) => arg === FILENAME ? "150 Ready to upload" : "500 Wrong filename"
    })
    return { server, client, readable }
}

describe("Upload", function() {

    const testPayloads = [ EMPTY_TEXT, SHORT_TEXT, LONG_TEXT, VERY_LONG_TEXT ]
    for (const payload of testPayloads) {
        it(`can upload ${payload.length} bytes`, async () => {
            const { server, client, readable } = await prep(payload)
            const ret = await client.uploadFrom(readable, FILENAME)
            assert.deepEqual(server.uploadedData, Buffer.from(payload, "utf-8"))
            return ret
        })
    }

    it("throws on unknown PASV command", async () => {
        const { server, client, readable } = await prep()
        server.addHandlers({
            "pasv": () => "500 Command unknown"
        })
        return assert.rejects(() => client.uploadFrom(readable, "NAME.TXT"), {
            name: "FTPError",
            message: "500 Command unknown"
        })  
    })

    it("throws on wrong PASV format", async () => {
        const { server, client, readable } = await prep()
        server.addHandlers({
            "pasv": () => "227 Missing IP"
        })
        return assert.rejects(() => client.uploadFrom(readable, "NAME.TXT"), {
            name: "Error",
            message: "Can't parse response to 'PASV': 227 Missing IP"
        })  
    })

    it("throws if data connection can't be opened", async () => {
        const { server, client, readable } = await prep()
        server.addHandlers({
            "pasv": () => "227 Entering Passive Mode (192,168,1,100,10,229)"
        })
        return assert.rejects(() => client.uploadFrom(readable, "NAME.TXT"), {
            name: "Error",
            message: "Can't open data connection in passive mode: connect ECONNREFUSED 127.0.0.1:2789"
        })  
    })

    it(`switches correctly between sockets to track timeout during transfer`, async () => {
        const { server, client, readable } = await prep()
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
        const { client } = await prep()
        const source = new Readable()
        source.destroy(new Error("Closing with specific ERROR"))
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            name: "Error",
            message: "Closing with specific ERROR"
        })
    })

    it("handles late error from source stream", async () => {
        const { server, client } = await prep()
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

    it("handles FTP errors during transfer", async () => {
        const { server, client } = await prep()
        const source = new Readable()
        source._read = () => {}
        source.push("the beginning...")
        server.didStartTransfer = () => {
            server.ctrlConn.write("500 Server reports some error during transfer")
        }
        return assert.rejects(() => client.uploadFrom(source, FILENAME), {
            name: "FTPError",
            message: "500 Server reports some error during transfer"
        })
    })

    it("handles closed data connection during transfer")
})