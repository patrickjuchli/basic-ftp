const assert = require("assert");
const Client = require("../lib/ftp").Client;
const FileInfo = require("../lib/ftp").FileInfo;
const SocketMock = require("./SocketMock");
const { FTPError } = require("../lib/FtpContext");

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
        f.type = FileInfo.Type.Directory,
        f)
    ];

    let client;
    beforeEach(function() {
        client = new Client(5000);
        client.prepareTransfer = client => {
            //@ts-ignore that SocketMock can't be assigned to client.ftp
            client.ftp.dataSocket = new SocketMock();
            return Promise.resolve({code: 200, message: "OK"});
        };
        //@ts-ignore
        client.ftp.socket = new SocketMock();
    });

    afterEach(function() {
        client.close();
    });

    function requestListAndVerify(done) {
        client.list().then(result => {
            assert.deepEqual(result, expList);
            done();
        });
    }

    it("sends the right command", function(done) {
        client.ftp.socket.once("didSend", command => {
            assert.equal(command, "LIST -a\r\n");
            done();
        });
        // This will throw an unhandled exception because we close the client when
        // the task is still running. Ignore the exception, this test is only about
        // the command that client.list() sends.
        client.list().catch(() => true /* Do nothing */);
    });

    it("handles data socket ending before control confirms", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
    });

    it("handles control confirming before data socket ends", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.socket.emit("data", "250 Done");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
        });
    });

    it("handles data coming in before control announces beginning", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
    });

    it("handles data transmission being complete before control announces beginning", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.socket.emit("data", "250 Done");
        });
    });

    it("handles control announcing with 150 instead of 125", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", "150 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "250 Done");
        });
    });

    it("handles control confirming end with 200 instead of 250", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "200 Done");
        });
    });

    it("relays FTP error response even if data transmitted completely", function() {
        setTimeout(() => {
            client.ftp.socket.emit("data", "125 Sending");
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", "500 Error");
        });
        return client.list().catch(err => {
            assert.deepEqual(err, new FTPError({code: 500, message: "500 Error"}));
        });
    });

    it("uses data connection exclusively for timeout tracking during download", function(done) {
        client.list().catch(() => {});
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
            client.ftp.dataSocket.end();
            assert.equal(client.ftp.socket.timeout, 5000, "transfer end (control)");
            assert.equal(client.ftp.dataSocket.timeout, 0, "transfer end (data)");
            // Transfer confirmed via control socket, stop tracking timeout altogether
            client.ftp.socket.emit("data", "250 Done");
            assert.equal(client.ftp.socket.timeout, 0, "confirmed end (control)");
            assert.equal(client.ftp.dataSocket, undefined, "data connection");
            done();
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
});
