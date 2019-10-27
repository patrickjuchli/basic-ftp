const assert = require("assert");
const SocketMock = require("./SocketMock");
const { Client } = require("../dist");
const mock = require("mock-fs")
const fs = require("fs")

describe("Download to file", function() {
    this.timeout(200)

    // Mock the filesystem
    beforeEach(() => mock({
        "existing.txt": "content"
    }));
    afterEach(mock.restore);

    // Mock an FTP client
    let client;
    beforeEach(function() {
        client = new Client(5000)
        client.prepareTransfer = ftp => {
            //@ts-ignore that SocketMock can't be assigned to client.ftp
            ftp.dataSocket = new SocketMock();
            //@ts-ignore
            ftp.dataSocket.connect()
            return Promise.resolve({code: 200, message: "OK"});
        };
        //@ts-ignore
        client.ftp.socket = new SocketMock();
    });
    afterEach(() => client.close());

    function sendData(str) {
        client.ftp.socket.emit("data", "125 Sending");
        client.ftp.dataSocket.emit("data", Buffer.from(str));
        client.ftp.dataSocket.end();
        client.ftp.socket.emit("data", "250 Done");
    }

    it("can download to a new, not yet existing file", async function() {
        setTimeout(() => sendData("hello"));
        await client.downloadTo("local.txt", "remote.txt", 0)
        const content = fs.readFileSync("local.txt", "utf-8")
        assert.equal(content, "hello")
    })

    it("truncates existing file with startAt=0", async function() {
        setTimeout(() => sendData("hello"));
        await client.downloadTo("existing.txt", "remote.txt", 0)
        const content = fs.readFileSync("existing.txt", "utf-8")
        assert.equal(content, "hello")
    })

    it("appends to existing file with start>0", async function() {
        setTimeout(() => sendData("hello"));
        await client.downloadTo("existing.txt", "remote.txt", 4)
        const content = fs.readFileSync("existing.txt", "utf-8")
        assert.equal(content, "conthello")
    })

    it("raises an error if appending to non-existing file", async function() {
        let code = ""
        try {
            await client.downloadTo("not_existing.txt", "remote.txt", 4)
        }
        catch(err) {
            code = err.code
        }
        assert.equal(code, "ENOENT", "Wrong expected exception")
    })

    it("removes a file on error and if not appending", async function() {
        setTimeout(() => {
            assert.equal(fs.existsSync("local.txt"), true, "File created right after method call")
            client.ftp.socket.emit("data", "500 Big Error");
        });
        try {
            await client.downloadTo("local.txt", "remote.txt")
        }
        catch(err) { /*Ignore*/ }
        assert.equal(fs.existsSync("local.txt"), false, "Empty file removed after error")
    })

    it("does not remove a file on error if appending", async function() {
        setTimeout(() => {
            assert.equal(fs.existsSync("existing.txt"), true, "File exists after method call")
            assert.equal(fs.readFileSync("existing.txt", "utf-8"), "content", "File untouched after method call")
            client.ftp.socket.emit("data", "500 Big Error");
        });
        try {
            await client.downloadTo("existing.txt", "remote.txt", 4)
        }
        catch(err) { /*Ignore*/ }
        assert.equal(fs.readFileSync("existing.txt", "utf-8"), "content", "File untouched after error")
    })

    it("does not remove a file on error if not appending but partial data present", async function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", Buffer.from("partialdownload"));
            client.ftp.socket.emit("data", "500 Big Error");
        });
        try {
            await client.downloadTo("local.txt", "remote.txt")
        }
        catch(err) { /*Ignore*/ }
        assert.equal(fs.existsSync("local.txt"), true, "Non-empty file present after error")
        assert.equal(fs.readFileSync("local.txt", "utf-8"), "partialdownload", "Non-empty file contains partial content after error")
    })
})