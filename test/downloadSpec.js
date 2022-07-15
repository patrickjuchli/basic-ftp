const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");
const { Writable } = require("stream")
const fs = require("fs");

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

const FILENAME = "file.txt"
const TIMEOUT = 1000

async function prep(payload = SHORT_TEXT) {
    const server = new MockFtpServer()
    const client = new Client(TIMEOUT)
    await client.access({
        port: server.ctrlAddress.port,
        user: "test",
        password: "test"
    })
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
    return { server, client }
}

describe("Download to stream", function() {
    const testPayloads = [ EMPTY_TEXT, SHORT_TEXT, MEDIUM_TEXT, LONG_TEXT ]
    for (const payload of testPayloads) {
        it(`can download ${payload.length} bytes`, async () => {
            const { client } = await prep(payload)
            const chunks = []
            const writable = new Writable()
            writable._write = (chunk, enc, cb) => { 
                chunks.push(chunk) 
                cb()
            }
            await client.downloadTo(writable, FILENAME)
            const actualPayload = Buffer.concat(chunks).toString("utf8")
            assert.deepEqual(actualPayload, payload)
        })
    }
    
    it("handles destination stream error", async () => {
        const { client } = await prep(SHORT_TEXT)
        return client.downloadTo(fs.createWriteStream("test"), "test.json").catch(err => {
            assert.equal(err.code, "EISDIR")
        })
    })

    it("handles server ending data connection during transfer")
    it("relays FTP error response even if data transmitted completely")
    it("stops tracking timeout after failure")
})
