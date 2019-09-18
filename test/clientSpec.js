const assert = require("assert");
const { Client, FTPError } = require("../dist");
const SocketMock = require("./SocketMock");

const featReply = `
211-Extensions supported:
 MLST size*;create
 SIZE
211 END
`;

const featEmptyReply = `
211 No features
`;

describe("Convenience API", function() {
    this.timeout(1000);
    let client;

    beforeEach(function() {
        client = new Client(2000);
        client.ftp._newSocket = () => new SocketMock();
        client.prepareTransfer = () => Promise.resolve({code: 200, message: "ok"}); // Don't change
        client.ftp.socket = new SocketMock();
        client.ftp.dataSocket = new SocketMock();
    });

    afterEach(function() {
        client.close();
    });

    /**
     * Testing simple convenience functions follows the same pattern:
     * 1. Call some method on client (func)
     * 2. This makes client send an FTP command (command)
     * 3. Which then results in a reply (reply). Use undefined to simulate a socket error.
     * 4. The tested client method will translate this into a result (result). Use MockError to expect exception to be thrown.
     */
    const tests = [
        {
            name: "can get a filesize",
            func: c => c.size("file.txt"),
            command: "SIZE file.txt\r\n",
            reply: "213 1234\r\n",
            result: 1234
        },
        {
            name: "can get last modified time",
            func: c => c.lastMod("file.txt"),
            command: "MDTM file.txt\r\n",
            reply: "213 19951217032400\r\n",
            result: new Date("1995-12-17T03:24:00+0000")
        },
        {
            name: "can get features",
            func: c => c.features(),
            command: "FEAT\r\n",
            reply: featReply,
            result: new Map([["MLST", "size*;create"], ["SIZE", ""]])
        },
        {
            name: "can handle empty feature response",
            func: c => c.features(),
            command: "FEAT\r\n",
            reply: featEmptyReply,
            result: new Map()
        },
        {
            name: "can handle error response when requesting features",
            func: c => c.features(),
            command: "FEAT\r\n",
            reply: "500 Error\r\n",
            result: new Map()
        },
        {
            name: "can send a command",
            func: c => c.send("TEST"),
            command: "TEST\r\n",
            reply: "200 Ok\r\n",
            result: { code: 200, message: "200 Ok" }
        },
        {
            name: "send command: can handle error",
            func: c => c.send("TEST", false),
            command: "TEST\r\n",
            reply: "500 Error\r\n",
            result: new FTPError({code: 500, message: "500 Error"})
        },
        {
            name: "send command: can optionally ignore error response (>=400)",
            func: c => c.send("TEST", true),
            command: "TEST\r\n",
            reply: "400 Error\r\n",
            result: { code: 400, message: "400 Error" }
        },
        {
            name: "send command: ignoring error responses still throws error for connection errors",
            func: c => c.send("TEST", true),
            command: "TEST\r\n",
            reply: undefined,
            result: new Error("some error (control socket)")
        },
        {
            name: "can get the working directory",
            func: c => c.pwd(),
            command: "PWD\r\n",
            reply: "257 \"/this/that\" is current directory.\r\n",
            result: "/this/that"
        },
        {
            name: "can change the working directory",
            func: c => c.cd("foo"),
            command: "CWD foo\r\n",
            reply: "250 Okay",
            result: { code: 250, message: "250 Okay" }
        },
        {
            name: "can remove a file",
            func: c => c.remove("foo.txt"),
            command: "DELE foo.txt\r\n",
            reply: "250 Okay",
            result: { code: 250, message: "250 Okay" }
        },
    ];

    tests.forEach(test => {
        it(test.name, function() {
            client.ftp.socket.once("didSend", buf => {
                assert.equal(buf.toString(), test.command);
                if (test.reply) {
                    client.ftp.socket.emit("data", test.reply);
                }
                else {
                    client.ftp.socket.emit("error", new Error("some error"));
                }
            });
            const promise = test.func(client);
            if (test.result instanceof Error) {
                return promise.catch(err => assert.deepEqual(err, test.result));
            }
            else {
                return promise.then(result => assert.deepEqual(result, test.result));
            }
        });
    });

    it("resets overall bytes of progress tracker on trackProgress()", function() {
        client._progressTracker.bytesOverall = 5;
        client.trackProgress();
        assert.equal(client._progressTracker.bytesOverall, 0, "bytesOverall after reset");
    });

    it("can connect", function() {
        const s = new SocketMock()
        s.connect = (options) => {
            assert.equal(options.host, "host");
            assert.equal(options.port, 22, "Socket port");
            setTimeout(() => client.ftp.socket.emit("data", "200 OK"));
        };
        client.ftp._newSocket = () => s
        return client.connect("host", 22).then(result => assert.deepEqual(result, { code: 200, message: "200 OK"}));
    });

    it("connecting reopens a client", function() {
        client.close()
        client.connect().catch(() => {})
        assert.equal(client.closed, false)
    })

    it("closing client reports client as closed", function() {
        client.close()
        assert.equal(client.closed, true)
    })

    it("client is described as closed when not connected yet", function() {
        const realClient = new Client()
        assert.equal(realClient.closed, true)
    })

    it("declines connect for code 120", function() {
        const s = new SocketMock()
        s.connect = () => {
            setTimeout(() => client.ftp.socket.emit("data", "120 Ready in 5 hours"));
        };
        client.ftp._newSocket = () => s
        return client.connect().catch(result => assert.deepEqual(result, new FTPError({code: 120, message: "120 Ready in 5 hours"})));
    });

    it("tracks timeout during connect", function() {
        const s = new SocketMock()
        s.connect = () => {
            setTimeout(() => {
                assert.equal(s.timeout, 2000);
                setTimeout(() => client.ftp.socket.emit("data", "200 Ok"));
            });
        };
        client.ftp._newSocket = () => s
        return client.connect().catch(() => {});
    });

    it("can login", function() {
        let step = 1;
        client.ftp.socket.on("didSend", buf => {
            if (step === 1) {
                step = 2;
                assert.equal(buf.toString().trim(), "USER user");
                client.ftp.socket.emit("data", "331 Go on");
            }
            else if (step === 2) {
                assert.equal(buf.toString().trim(), "PASS pass");
                client.ftp.socket.emit("data", "200 OK");
            }
        });
        return client.login("user", "pass").then(result => assert.deepEqual(result, { code: 200, message: "200 OK" }));
    });

    it("declines login on '332 Account needed'", function() {
        client.ftp.socket.once("didSend", () => {
            client.ftp.socket.emit("data", "332 Account needed");
        });
        return client.login("user", "pass").catch(result => assert.deepEqual(result, new FTPError({code: 332, message: "332 Account needed"})));
    });

    it("handles leading whitespace in names", function() {
        let step = 1;
        client.ftp.socket.on("didSend", buf => {
            if (step === 1) {
                step = 2
                // There is leading whitespace in the requested filename so first the client
                // should first ask for PWD to then create an absolute path.
                assert.equal(buf.trim(), "PWD");
                client.ftp.socket.emit("data", `257 "/test" is current directory.`);
            }
            else if (step === 2) {
                assert.equal(buf.trim(), "SIZE /test/  test.json")
                client.ftp.socket.emit("data", `257 1234567`);
            }
        });
        return client.size("  test.json");
    });
});
