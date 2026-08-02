const { describe, it, beforeEach } = require("node:test");
const assert = require("assert");
const FTPContext = require("../dist").FTPContext;
const SocketMock = require("./SocketMock");
const tls = require("tls");
const net = require("net");

describe("FTPContext", { timeout: 100 }, () => {
    /** @type {FTPContext} */
    let ftp;
    beforeEach(() => {
        ftp = new FTPContext();
        ftp.socket = new SocketMock();
        ftp.dataSocket = new SocketMock();
    });

    it("Setting new control socket destroys current", () => {
        const old = ftp.socket;
        ftp.socket = new SocketMock();
        assert.equal(old.destroyed, true);
        assert.equal(ftp.closed, true)
    });

    it("Upgrading control socket doesn't destroy it", () => {
        const old = ftp.socket;
        const upgrade = new SocketMock();
        old.localPort = upgrade.localPort = 123
        ftp.socket = upgrade
        assert.equal(old.destroyed, false);
    });

    it("Relays control socket timeout event", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, new Error("Timeout (control socket)"));
            resolve();
        });
        ftp.socket.emit("timeout");
    }));

    it("Relays control socket error event", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, new Error("hello (control socket)"));
            resolve();
        });
        ftp.socket.emit("error", new Error("hello"));
    }));

    it("Relays data socket timeout event", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, new Error("Timeout (data socket)"));
            resolve();
        });
        // @ts-ignore
        ftp.dataSocket.emit("timeout");
    }));

    it("Relays data socket error event", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, new Error("hello (data socket)"));
            resolve();
        });
        // @ts-ignore
        ftp.dataSocket.emit("error", new Error("hello"));
    }));

    it("Relays single line control response", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, { code: 200, message: "200 OK"});
            resolve();
        });
        ftp.socket.emit("data", "200 OK");
    }));

    it("Relays multiline control response", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            resolve();
        });
        ftp.socket.emit("data", "200-OK\r\nHello\r\n200 OK");
    }));

    it("Relays multiple multiline control responses in separate callbacks", () => new Promise(resolve => {
        const exp = new Set(["200-OK\n200 OK", "200-Again\n200 Again" ]);
        ftp.handle(undefined, res => {
            assert.equal(true, exp.has(res.message));
            exp.delete(res.message);
            if (exp.size === 0) {
                resolve();
            }
        });
        ftp.socket.emit("data", "200-OK\r\n200 OK\r\n200-Again\r\n200 Again");
    }));

    it("Relays chunked multiline response as a single response", () => new Promise(resolve => {
        ftp.handle(undefined, res => {
            assert.deepEqual(res, { code: 200, message: "200-OK\nHello\n200 OK"});
            resolve();
        });
        ftp.socket.emit("data", "200-OK\r\n");
        ftp.socket.emit("data", "Hello\r\n200 OK");
    }));

    it("Stops relaying if task is resolved", () => new Promise(resolve => {
        ftp.handle(undefined, (res, task) => {
            if (res instanceof Error) {
                assert.fail("Relayed message is an error.");
            }
            else if (res.code === 220) {
                assert.fail("Relayed message when it shouldn't have.");
            }
            task.resolve(true);
        }).then(() => {
            ftp.socket.emit("data", "220 Done");
            resolve();
        });
        ftp.socket.emit("data", "200 OK");
    }));

    it("can send a command", () => new Promise(resolve => {
        ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "HELLO TEST\r\n");
            resolve();
        });
        ftp.send("HELLO TEST");
    }));

    it("is using UTF-8 by default", () => new Promise(resolve => {
        ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "HELLO 直己\r\n");
            resolve();
        });
        ftp.send("HELLO 直己");
    }));

    it("reports whether socket has TLS", () => {
        ftp.socket = new net.Socket();
        assert(!ftp.hasTLS);
        ftp.socket = new tls.TLSSocket(ftp.socket);
        assert(ftp.hasTLS);
    });

    it("queues an error if no task is active and assigns it to the next task", () => {
        ftp.socket.emit("error", new Error("some error"));
        return ftp.handle("TEST", (res, task) => {
            const err = new Error("Client is closed because some error (control socket)");
            err.code = 0;
            assert.deepEqual(res, err);
            assert.notEqual(-1, res.stack.indexOf("Closing reason: Error: some error (control socket)"));
            task.resolve();
        });
    });

    // A handler can hold on to its resolver and use it after its task has been settled, e.g. when
    // a stream reports an error late. The next task must not lose its response because of that.
    it("Settling a task again doesn't affect the task after it", () => {
        let staleResolver
        const first = ftp.handle("FIRST", (res, task) => {
            staleResolver = task
            task.resolve(res)
        })
        ftp.socket.emit("data", "200 First done");
        return first.then(() => {
            const second = ftp.handle("SECOND", (res, task) => task.resolve(res))
            staleResolver.reject(new Error("Late error of the first task"))
            ftp.socket.emit("data", "200 Second done");
            return second
        }).then(res => {
            assert.equal(res.message, "200 Second done")
        })
    });

    it("timeout of control socket is initially 0", () => {
        const c = new FTPContext(10000);
        c.socket = new SocketMock();
        assert.equal(c.socket.timeout, 0);
    });

    it("timeout of control socket is only tracked during a task", () => {
        const c = new FTPContext(10000);
        c.socket = new SocketMock();
        assert.equal(c.socket.timeout, 0, "initial idle timeout");
        const taskPromise = c.handle("TEST", (res, task) => task.resolve(res));
        assert.equal(c.socket.timeout, 10000, "timeout after starting task");
        c.socket.emit("data", "200 Bingo");
        return taskPromise.then(() => {
            assert.equal(c.socket.timeout, 0, "timeout after resolving task");
        });
    });
});
