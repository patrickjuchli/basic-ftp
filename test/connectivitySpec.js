const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");

async function prep() {
    const server = new MockFtpServer()
    const client = new Client(1000)
    return { server, client }
}

describe("Connectivity", function() {

    this.beforeEach(() => {
        this.server = new MockFtpServer()
        this.client = new Client(1000)
    })

    this.afterEach(() => {
        this.client.close()
        this.server.close()
    })

    it.only("can access server", async () => {
        return this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
    });

    it("throws if connection failed", async () => {
        const { server, client } = await prep()
        return assert.rejects(() => client.access({
            port: 111,
            user: "test",
            password: "test"
        }), {
            name: "Error",
            code: "ECONNREFUSED"
        })
    })

    it("throws if password wrong", async () => {
        const { server, client } = await prep()
        return assert.rejects(() => client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "WRONGPASSWORD"
        }), {
            name: "FTPError",
            message: "530 Wrong password"
        })
    })

    it("throws if user unknown", async () => {
        const { server, client } = await prep()
        return assert.rejects(() => client.access({
            port: server.ctrlAddress.port,
            user: "UNKNOWNUSER",
            password: "test"
        }), {
            name: "FTPError",
            message: "530 Unknown user"
        })
    })

    it("access executes default set of commands", async () => {
        const { server, client } = await prep()
        server.handlers = {
            // Set the minimum required commands, not all default settings need to succeed.
            user: () => "200 OK",
            type: () => "200 OK"
        }
        const ret = await client.access({
            port: server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
        assert.deepEqual(server.receivedCommands, [
            "USER test",
            "FEAT",
            "TYPE I",
            "STRU F",
            "OPTS UTF8 ON"
        ])
        return ret
    });

    it("client reflects closed state correctly", async () => {
        const { server, client } = await prep()
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
            message: "Client is closed"
        })
    });
})