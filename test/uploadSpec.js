const assert = require("assert");
const fs = require("fs");
const { Client, FTPError } = require("../dist");
const SocketMock = require("./SocketMock");

describe("Upload", function() {
    this.timeout(100);

    let readable;
    let client;
    beforeEach(function() {
        readable = fs.createReadStream("test/resources/test.txt");
        client = new Client(5000);
        client.prepareTransfer = () => Promise.resolve({code: 200, message: "ok"}); // Don't change
        client.ftp.socket = new SocketMock();
        client.ftp.dataSocket = new SocketMock();
        //@ts-ignore
        client.ftp.dataSocket.connect()
    });

    afterEach(function() {
        client.close();
    });

    it("sends the correct command", function(done) {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "STOR NAME.TXT\r\n");
            done();
        });
        client.uploadFrom(readable, "NAME.TXT").catch(() => {});
    });

    it("starts uploading after receiving 'ready to upload'", function(done) {
        let didSendReady = false;
        client.ftp.dataSocket.once("didSend", buf => {
            assert(didSendReady, "Didn't send ready");
            assert.equal(buf.toString(), "123", "Wrong data sent");
            done();
        });
        client.uploadFrom(readable, "NAME.TXT").catch(() => {});
        setTimeout(() => {
            didSendReady = true;
            client.ftp.socket.emit("data", "150 Ready");
        });
    });

    it("waits for secureConnect if TLS is enabled", function(done) {
        client.ftp.socket.encrypted = true; // Fake encrypted socket
        client.ftp.dataSocket.getCipher = () => undefined; // Fake state before TLS session ready
        let didWait = false;
        client.ftp.dataSocket.once("didSend", buf => {
            assert(didWait, "Didn't wait for secureConnect");
            assert.equal(buf.toString(), "123", "Wrong data sent");
            done();
        });
        client.uploadFrom(readable, "NAME.TXT").catch(() => {});
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Ready");
            setTimeout(() => {
                client.ftp.dataSocket.emit("secureConnect");
                didWait = true;
            });
        });
    });

    it("explicitly closes the data socket when all has been transmitted", function(done) {
        client.ftp.dataSocket.on("didSend", () => {
            // Finish event should trigger closing of data socket.
            client.ftp.dataSocket.emit("finish");
            setTimeout(() => {
                assert(client.ftp.dataSocket.destroyed, "Data socket not closed.");
                done();
            });
        });
        client.uploadFrom(readable, "NAME.TXT").catch(() => {});
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Ready");
            // Don't send completion message, we don't want the TransferResolver
            // closing the data socket but the upload procedure itself.
        });
    });

    it("handles control confirmation before data sent completely", function() {
        client.ftp.dataSocket.on("didSend", () => {
            client.ftp.dataSocket.emit("finish");
            setTimeout(() => client.ftp.socket.emit("data", "200 Done"));
        });
        const promise = client.uploadFrom(readable, "NAME.TXT");
        setTimeout(() => client.ftp.socket.emit("data", "150 Ready"));
        return promise;
    });

    it("handles data sent completely before control confirmation", function() {
        client.ftp.dataSocket.on("didSend", () => {
            client.ftp.dataSocket.emit("finish");
            setTimeout(() => client.ftp.socket.emit("data", "200 Done"));
        });
        const promise = client.uploadFrom(readable, "NAME.TXT");
        setTimeout(() => client.ftp.socket.emit("data", "150 Ready"));
        return promise;
    });

    it("handles errors", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Ready");
            client.ftp.socket.emit("data", "500 Error");
        });
        return client.uploadFrom(readable, "NAME.TXT").catch(err => {
            assert.deepEqual(err, new FTPError({code: 500, message: "500 Error"}));
        });
    });

    it("handles error events from the source stream", function() {
        const nonExistingFile = fs.createReadStream("nothing.txt");
        return client.uploadFrom(nonExistingFile, "NAME.TXT").catch(err => {
            assert.equal(err.code, "ENOENT")
        })
    })

    it("uses data connection exclusively for timeout tracking during upload", function(done) {
        client.uploadFrom(readable, "NAME.TXT").catch(() => {});
        // Before anything: No timeout tracking at all
        assert.equal(client.ftp.socket.timeout, 0, "before task (control)");
        assert.equal(client.ftp.dataSocket.timeout, 0, "before task (data)");
        setTimeout(() => {
            // Task started, control socket tracks timeout
            assert.equal(client.ftp.socket.timeout, 5000, "task started (control)");
            assert.equal(client.ftp.dataSocket.timeout, 0, "task started (data)");
            // Data transfer will start, data socket tracks timeout
            client.ftp.socket.emit("data", "125 Sending");
            assert.equal(client.ftp.socket.timeout, 0, "transfer start (control)");
            assert.equal(client.ftp.dataSocket.timeout, 5000, "transfer start (data)");
            // Data transfer is done, control socket tracks timeout
            client.ftp.dataSocket.emit("finish");
            assert.equal(client.ftp.socket.timeout, 5000, "transfer end (control)");
            assert.equal(client.ftp.dataSocket.timeout, 0, "transfer end (data)");
            // Transfer confirmed via control socket, stop tracking timeout altogether
            client.ftp.socket.emit("data", "250 Done");
            assert.equal(client.ftp.socket.timeout, 0, "confirmed end (control)");
            assert.equal(client.ftp.dataSocket, undefined, "data connection");
            done();
        });
    });
});
