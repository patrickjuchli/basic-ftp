const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");

describe("Connectivity", function() {

    this.beforeEach(() => {
        this.server = new MockFtpServer()
        this.client = new Client(1000)
    })

    this.afterEach(() => {
        this.client.close()
        this.server.close()
    })

    it("can access a server", () => {
        return this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        }).then(result => {
            assert.strictEqual(result.code, 200, "Welcome response")
        })
    });

    it("throws if connection failed", () => {
        return assert.rejects(() => this.client.access({
            port: 111,
            user: "test",
            password: "test"
        }), {
            name: "Error",
            code: "ECONNREFUSED"
        })
    })

    it("throws if password wrong", () => {
        return assert.rejects(() => this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "WRONGPASSWORD"
        }), {
            name: "FTPError",
            message: "530 Wrong password"
        })
    })

    it("throws if user unknown", () => {
        return assert.rejects(() => this.client.access({
            port: this.server.ctrlAddress.port,
            user: "UNKNOWNUSER",
            password: "test"
        }), {
            name: "FTPError",
            message: "530 Unknown user"
        })
    })

    it("access executes default set of commands", () => {
        this.server.handlers = {
            // Set the minimum required commands, not all default settings need to succeed.
            user: () => "200 OK",
            type: () => "200 OK"
        }
        return this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        }).then(() => {
            assert.deepEqual(this.server.receivedCommands, [
                "USER test",
                "FEAT",
                "TYPE I",
                "STRU F",
                "OPTS UTF8 ON"
            ])
        })
    });

    it("client reflects closed state correctly", async () => {
        assert.strictEqual(this.client.closed, true, "before access")
        await this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
        assert.strictEqual(this.client.closed, false, "after access")
        this.client.close()
        assert.strictEqual(this.client.closed, true, "after close")
        return assert.rejects(() => this.client.send("TYPE I"), {
            name: "Error",
            message: "Client is closed"
        })
    });

    it("can connect using explicit TLS")
    it("can connect using implicit TLS")
})