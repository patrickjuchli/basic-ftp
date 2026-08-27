const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const net = require("net");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");

describe("Connectivity", () => {

    let server, client;

    beforeEach(() => {
        server = new MockFtpServer()
        client = new Client(50)
    })

    afterEach(() => {
        client.close()
        server.close()
    })

    it("throws error when sending before connecting", () => {
        return assert.rejects(() => client.send("hi"), {
            message: "Socket is closed (control socket)"
        })
    })

    it("handles closing uninitialized socket", () => {
        client.close()
    })

    it("can access a server", () => {
        return client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "test"
        }).then(result => {
            assert.strictEqual(result.code, 200, "Welcome response")
        })
    });

    // Uses a server that accepts the connection but never sends its greeting. Aiming at a host
    // that swallows the connection attempt instead would leave it to the network whether the
    // client runs into its timeout or gets an error like ECONNREFUSED right away.
    it("throws on timeout when accessing a server", async () => {
        const connections = []
        const silentServer = net.createServer(conn => {
            connections.push(conn)
            conn.on("error", () => {})
        })
        await new Promise(resolve => silentServer.listen(0, "127.0.0.1", resolve))
        try {
            await assert.rejects(() => client.access({
                port: silentServer.address().port
            }), {
                message: "Timeout (control socket)"
            })
        }
        finally {
            connections.forEach(conn => conn.destroy())
            silentServer.close()
        }
    })

    // Uses a port that was bound and released again: the OS is free to hand it out, but nothing
    // listens on it right now. A fixed port number could be in use on the machine running this.
    it("throws if connection failed", async () => {
        const probe = net.createServer()
        await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve))
        const port = probe.address().port
        await new Promise(resolve => probe.close(resolve))
        await assert.rejects(() => client.access({ port }), {
            code: "ECONNREFUSED"
        })
    })

    it("throws if password wrong", () => {
        return assert.rejects(() => client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "WRONGPASSWORD"
        }), {
            name: "FTPError",
            message: "530 Wrong password"
        })
    })

    it("throws if user unknown", () => {
        return assert.rejects(() => client.access({
            port: server.ctrlAddress.port,
            user: "UNKNOWNUSER",
            password: "test"
        }), {
            name: "FTPError",
            message: "530 Unknown user"
        })
    })

    it("access executes default set of commands", () => {
        server.handlers = {
            // Set the minimum required commands, not all default settings need to succeed.
            user: () => "200 OK",
            type: () => "200 OK"
        }
        return client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "test"
        }).then(() => {
            assert.deepEqual(server.receivedCommands, [
                "OPTS UTF8 ON",
                "USER test",
                "FEAT",
                "TYPE I",
                "STRU F",
                "OPTS UTF8 ON",
            ])
        })
    });

    it("client reflects closed state correctly", async () => {
        assert.strictEqual(client.closed, true, "before access")
        await client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
        assert.strictEqual(client.closed, false, "after access")
        client.close()
        assert.strictEqual(client.closed, true, "after close")
        return assert.rejects(() => client.send("TYPE I"), {
            name: "Error",
            message: "Client is closed because User closed client"
        })
    });

    it.todo("can connect using explicit TLS")
    it.todo("can connect using implicit TLS")
})
