const assert = require("assert");
const FTPContext = require("../lib/ftp").FTPContext;
const SocketMock = require("./SocketMock");
const tls = require("tls");
const net = require("net");

describe("FTPContext", function() {
    this.timeout(100);
    let ftp;
    beforeEach(function() {
        ftp = new FTPContext();
        ftp.socket = new SocketMock();
        ftp.dataSocket = new SocketMock();
    });

    it("Setting new control socket doesn't destroy current", function() {
        const old = ftp.socket;
        ftp.socket = new SocketMock();
        assert.equal(old.destroyed, false, "Socket not destroyed.");
    });

    it("Setting control socket to undefined destroys current", function() {
        const old = ftp.socket;
        ftp.socket = undefined;
        assert.equal(old.destroyed, true, "Socket destroyed.");
    });

    it("Setting new data socket destroys current", function() {
        const old = ftp.dataSocket;
        ftp.dataSocket = undefined;
        assert.equal(old.destroyed, true, "Socket destroyed.");
    });

    it("Relays control socket timeout event", function(done) {
        ftp.handle(undefined, err => {
            assert.deepEqual(err, new Error("Timeout (control socket)"));
            done();
        });
        ftp.socket.emit("timeout");
    });

    it("Relays control socket error event", function(done) {
        ftp.handle(undefined, err => {
            assert.deepEqual(err, new Error("hello (control socket)"));
            done();
        });
        ftp.socket.emit("error", new Error("hello"));
    });

    it("Relays data socket timeout event", function(done) {
        ftp.handle(undefined, err => {
            assert.deepEqual(err, new Error("Timeout (data socket)"));
            done();
        });
        ftp.dataSocket.emit("timeout");
    });

    it("Relays data socket error event", function(done) {
        ftp.handle(undefined, err => {
            assert.deepEqual(err, new Error("hello (data socket)"));
            done();
        });
        ftp.dataSocket.emit("error", new Error("hello"));
    });

    it("Relays single line control response", function(done) {
        ftp.handle(undefined, (err, res) => {
            assert.deepEqual(res, { code: 200, message: "200 OK"});
            done();
        });
        ftp.socket.emit("data", "200 OK");
    });

    it("Relays multiline control response", function(done) {
        ftp.handle(undefined, (err, res) => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            done();
        });
        ftp.socket.emit("data", "200-OK\r\nHello\r\n200 OK");
    });

    it("Relays multiple multiline control responses in separate callbacks", function(done) {
        const exp = new Set(["200-OK\n200 OK", "200-Again\n200 Again" ]);
        ftp.handle(undefined, (err, res) => {
            assert.equal(true, exp.has(res.message));
            exp.delete(res.message);
            if (exp.size === 0) {
                done();
            }
        });
        ftp.socket.emit("data", "200-OK\r\n200 OK\r\n200-Again\r\n200 Again");
    });

    it("Relays chunked multiline response as a single response", function(done) {
        ftp.handle(undefined, (err, res) => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            done();
        });
        ftp.socket.emit("data", "200-OK\r\n");
        ftp.socket.emit("data", "Hello\r\n200 OK");
    });

    it("Stops relaying if task is resolved", function(done) {
        ftp.handle(undefined, (err, res, task) => {
            if (res.code === 220) {
                assert.fail("Relayed message when it shouldn't have.");
            }
            task.resolve(true);
        }).then(() => {
            ftp.socket.emit("data", "220 Done");
            done();
        });
        ftp.socket.emit("data", "200 OK");
    });

    it("can send a command", function(done) {
        ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "HELLO TEST\r\n");
            done();
        });
        ftp.send("HELLO TEST");
    });

    it("is using UTF-8 by default", function(done) {
        ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "HELLO 直己\r\n");
            done();
        });
        ftp.send("HELLO 直己");
    });

    it("reports whether socket has TLS", function() {
        ftp.socket = new net.Socket();
        assert(!ftp.hasTLS);
        ftp.socket = new tls.TLSSocket();
        assert(ftp.hasTLS);
    });

    it("queues an error if no task is active and assigns it to the next task", function() {
        ftp.socket.emit("error", new Error("some error"));
        return ftp.handle("TEST", (err, res, task) => {
            err = new Error("Client has been closed: some error (control socket)");
            err.code = 0;
            assert.deepEqual(err, err);
            task.resolve();
        });
    });
});
