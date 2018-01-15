const assert = require("assert");
const FTPContext = require("../lib/ftp").FTPContext;
const EventEmitter = require("events");

class SocketMock extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
    }
    removeAllListeners() {
    }
    setKeepAlive() {
    }
    setTimeout() {
    }
    destroy() {
        this.destroyed = true;
    }
    write() {
    }
}

describe("FTPContext", function() {

    let ftp;
    beforeEach(function() {
        ftp = new FTPContext();
        ftp.socket = new SocketMock();
        ftp.dataSocket = new SocketMock();
    });

    it("Setting data socket undefined destroys current", function() {
        const old = ftp.dataSocket;
        ftp.dataSocket = undefined;
        assert.equal(old.destroyed, true, "Socket not destroyed.");
    });

    it("Relays control timeout event", function(done) {
        ftp.handle(undefined, (res, task) => {
            assert.deepEqual(res, { error: "Timeout" });
            done();
        });
        ftp.socket.emit("timeout");
    });

    it("Relays control error event", function(done) {
        ftp.handle(undefined, (res, task) => {
            assert.deepEqual(res, { error: { foo: "bar" } });
            done();
        });
        ftp.socket.emit("error", { foo: "bar" });
    });

    it("Relays single line control response", function(done) {
        ftp.handle(undefined, (res, task) => {
            assert.deepEqual(res, { code: 200, message: "200 OK"});
            done();
        });
        ftp.socket.emit("data", Buffer.from("200 OK"));
    });

    it("Relays multiline control response", function(done) {
        ftp.handle(undefined, (res, task) => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            done();
        });
        ftp.socket.emit("data", Buffer.from("200-OK\r\nHello\r\n200 OK"));
    });

    it("Relays multiple multiline control responses in separate callbacks", function(done) {
        const exp = new Set(["200-OK\n200 OK", "200-Again\n200 Again" ]);
        ftp.handle(undefined, (res, task) => {
            assert.equal(true, exp.has(res.message));
            exp.delete(res.message);
            if (exp.size === 0) {
                done();
            }
        });
        ftp.socket.emit("data", Buffer.from("200-OK\r\n200 OK\r\n200-Again\r\n200 Again"));
    });

    it("Relays chunked multiline response as a single response", function(done) {
        ftp.handle(undefined, (res, task) => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            done();
        });
        ftp.socket.emit("data", Buffer.from("200-OK\r\n"));     
        ftp.socket.emit("data", Buffer.from("Hello\r\n200 OK")); 
    });

    it("Stops relaying if task is resolved", function(done) {
        ftp.handle(undefined, (res, task) => {
            if (res.code === 220) {
                assert.fail("Relayed message when it shouldn't have.");
            }
            task.resolve(true);
        }).then(() => {
            ftp.socket.emit("data", Buffer.from("220 Done"));
            done();
        });
        ftp.socket.emit("data", Buffer.from("200 OK"));  
    });
});
