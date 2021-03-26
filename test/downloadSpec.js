const assert = require("assert");
const SocketMock = require("./SocketMock");
const { Client, FileInfo, FileType, FTPError } = require("../dist");
const fs = require("fs")

/**
 * Downloading a directory listing uses the same mechanism as downloading in general,
 * we don't need to repeat all tests for downloading files.
 */
describe("Download directory listing", function() {
    this.timeout(100);
    var f;
    const bufList = Buffer.from("12-05-96  05:03PM       <DIR>          myDir");
    const expList = [
        (f = new FileInfo("myDir"),
        f.size = 0,
        f.date = "12-05-96 05:03PM",
        f.type = FileType.Directory,
        f)
    ];

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

    afterEach(function() {
        client.close();
    });

    function sendCompleteList() {
        client.ftp.socket.emit("data", "125 Sending");
        client.ftp.dataSocket.emit("data", bufList);
        client.ftp.dataSocket.end()
        client.ftp.socket.emit("data", "250 Done");
    }

    function requestListAndVerify() {
        return client.list().then(result => {
            assert.deepEqual(result, expList);
        });
    }

    it("handles data socket ending before control confirms", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
        return requestListAndVerify();
    });

    it("handles control confirming before data socket ends", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.socket.emit("data", "250 Done");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
        });
        return requestListAndVerify();
    });

    it("handles data coming in before control announces beginning", function() {
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
        return requestListAndVerify();
    });

    it("handles data transmission being complete before control announces beginning", function() {
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.socket.emit("data", "250 Done");
        });
        return requestListAndVerify();
    });

    it("handles control announcing with 150 instead of 125", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
        return requestListAndVerify();
    });

    it("handles control confirming end with 200 instead of 250", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "200 Done");
        });
        return requestListAndVerify();
    });

    it("relays FTP error response even if data transmitted completely", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "500 Error");
        });
        client.availableListCommands = ["LIST"]
        return client.list().catch(err => {
            assert.deepEqual(err, new FTPError({code: 500, message: "500 Error"}));
        });
    });

    it("uses data connection exclusively for timeout tracking during download", function(done) {
        client.list().catch(() => {});
        // Before anything: No timeout tracking at all
        assert.equal(client.ftp.socket.timeout, 0, "before task (control)");
        if (client.ftp.dataSocket) { // Data socket might not even be set yet
            assert.equal(client.ftp.dataSocket.timeout, 0, "before task (data)");
        }
        setTimeout(() => {
            // Task started, control socket tracks timeout
            assert.equal(client.ftp.socket.timeout, 5000, "task started (control)");
            assert.equal(client.ftp.dataSocket.timeout, 0, "task started (data)");
            // Data transfer will start, data socket tracks timeout
            client.ftp.socket.emit("data", "125 Sending");
            assert.equal(client.ftp.socket.timeout, 0, "transfer start (control)");
            assert.equal(client.ftp.dataSocket.timeout, 5000, "transfer start (data)");
            // Data transfer is done, control socket tracks timeout
            client.ftp.dataSocket.end();
            setTimeout(() => {
                assert.equal(client.ftp.socket.timeout, 5000, "transfer end (control)");
                assert.equal(client.ftp.dataSocket.timeout, 0, "transfer end (data)");
                // Transfer confirmed via control socket, stop tracking timeout altogether
                client.ftp.socket.emit("data", "250 Done");
                assert.equal(client.ftp.socket.timeout, 0, "confirmed end (control)");
                assert.equal(client.ftp.dataSocket, undefined, "data connection");
                done();
            })
        });
    });

    it("stops tracking timeout after failure", function(done) {
        client.list().catch(() => {});
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.socket.emit("data", "500 Error");
            assert.equal(client.ftp.socket.timeout, 0);
            done();
        });
    });

    it("handles destination stream error", function() {
        return client.download(fs.createWriteStream("test"), "test.json").catch(err => {
            assert.equal(err.code, "EISDIR")
        })
    })

    it("sends the right default command", function() {
        client.ftp.socket.once("didSend", command => {
            assert.equal(command, "LIST -a\r\n");
            sendCompleteList()
        });
        // This will throw an unhandled exception because we close the client when
        // the task is still running. Ignore the exception, this test is only about
        // the command that client.list() sends.
        return client.list()
    });

    it("sends the right default command with optional path", function() {
        client.ftp.socket.once("didSend", command => {
            assert.equal(command, "LIST -a my/path\r\n", "Unexpected list command");
            sendCompleteList()
        });
        // This will throw an unhandled exception because we close the client when
        // the task is still running. Ignore the exception, this test is only about
        // the command that client.list() sends.
        return client.list("my/path")//.catch(() => true /* Do nothing */);
    });

    it("tries all other list commands if default one fails", function() {
        const expectedCandidates = ["LIST -a", "LIST"]
        client.ftp.socket.on("didSend", command => {
            const expected = expectedCandidates.shift()
            assert.equal(command, expected + "\r\n", "Unexpected list command candidate");
            if (expectedCandidates.length === 0) {
                sendCompleteList()
            }
            else {
                client.ftp.socket.emit("data", "501 Syntax error")
            }
        });
        return client.list();
    })

    it("throws error of last candidate when all available list commands fail", function() {
        let counter = 1
        client.ftp.socket.on("didSend", () => {
            client.ftp.socket.emit("data", "501 Syntax error " + counter)
            counter++
        });
        return client.list().catch(err => {
            assert.equal(err.message, "501 Syntax error 2")
        });
    })

    it("uses first successful list command for all subsequent requests", function() {
        const promise = client.list().then(result => {
            assert.deepEqual(result, expList);
            assert.deepEqual(["LIST -a"], client.availableListCommands)
        });
        setTimeout(() => sendCompleteList());
        return promise
    })

    it("transparently rethrows list error if only one candidate available", function() {
        // Typically, only one candidate is available after a successful auto-detection
        // of a compatible one. If there's an error we want to know about it directly.
        client.availableListCommands = ["LIST"]
        client.ftp.socket.on("didSend", () => {
            client.ftp.socket.emit("data", "501 Syntax error")
        });
        return client.list().catch(err => {
            assert.equal(err.message, "501 Syntax error")
        });
    })
});
