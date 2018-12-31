const assert = require("assert");
const fs = require("fs");
const Client = require("../lib/ftp").Client;
const SocketMock = require("./SocketMock");
const { FTPError } = require("../lib/FtpContext");

describe("Upload", function() {
    this.timeout(100);

    let readable;
    let client;
    beforeEach(function() {
        readable = fs.createReadStream("test/resources/test.txt");
        client = new Client();
        client.prepareTransfer = () => {}; // Don't change
        client.ftp.socket = new SocketMock();
        client.ftp.dataSocket = new SocketMock();
    });

    afterEach(function() {
        client.close();
    });

    it("sends the correct command", function(done) {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "STOR NAME.TXT\r\n");
            done();
        });
        client.upload(readable, "NAME.TXT").catch(() => {});
    });

    it("starts uploading after receiving 'ready to upload'", function(done) {
        let didSendReady = false;
        client.ftp.dataSocket.once("didSend", buf => {
            assert(didSendReady, "Didn't send ready");
            assert.equal(buf.toString(), "123", "Wrong data sent");
            done();
        });
        client.upload(readable, "NAME.TXT").catch(() => {});
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
        client.upload(readable, "NAME.TXT").catch(() => {});
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
        client.upload(readable, "NAME.TXT").catch(() => {});
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
        const promise = client.upload(readable, "NAME.TXT");
        setTimeout(() => client.ftp.socket.emit("data", "150 Ready"));
        return promise;
    });

    it("handles data sent completely before control confirmation", function() {
        client.ftp.dataSocket.on("didSend", () => {
            client.ftp.dataSocket.emit("finish");
            setTimeout(() => client.ftp.socket.emit("data", "200 Done"));
        });
        const promise = client.upload(readable, "NAME.TXT");
        setTimeout(() => client.ftp.socket.emit("data", "150 Ready"));
        return promise;
    });

    it("handles errors", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Ready");
            client.ftp.socket.emit("data", "500 Error");
        });
        return client.upload(readable, "NAME.TXT").catch(err => {
            assert.deepEqual(err, new FTPError({code: 500, message: "500 Error"}));
        });
    });
});
