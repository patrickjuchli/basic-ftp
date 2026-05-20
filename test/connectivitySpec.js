const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
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

    it("throws on timeout when accessing a server", () => {
        return assert.rejects(() => client.access({
            host: "192.168.0.123"
        }), {
            message: "Timeout (control socket)"
        })
    })

    it("throws if connection failed", () => {
        return assert.rejects(() => client.access({
            port: 111
        }), {
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
