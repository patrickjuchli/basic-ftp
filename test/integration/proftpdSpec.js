"use strict";

const assert = require("assert");
const path = require("path");
const { Readable, Writable } = require("stream");
const { GenericContainer, Wait } = require("testcontainers");
const { Client } = require("../../dist");

// Passive ports are fixed: container port N maps to host port N so ProFTPD's
// PASV/EPSV response (advertising 127.0.0.1:N) reaches the right host port.
const PASSIVE_PORT_START = 30000;
const PASSIVE_PORT_END   = 30009;
const PASSIVE_PORTS = Array.from(
    { length: PASSIVE_PORT_END - PASSIVE_PORT_START + 1 },
    (_, i) => ({ container: PASSIVE_PORT_START + i, host: PASSIVE_PORT_START + i })
);

function bufferReadable(content) {
    const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const r = new Readable({ read() {} });
    r.push(buf);
    r.push(null);
    return r;
}

function collectWritable() {
    const chunks = [];
    const w = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk); cb(); }
    });
    w.data = () => Buffer.concat(chunks);
    return w;
}

describe("ProFTPD integration", function() {

    /** @type {import("testcontainers").StartedTestContainer} */
    let container;
    let controlPort;

    before(async function() {
        this.timeout(180_000); // image build + container start can be slow on first run

        const image = await GenericContainer
            .fromDockerfile(path.join(__dirname, "proftpd"))
            .build("basic-ftp-proftpd-test:latest", { deleteOnExit: false });

        container = await image
            .withExposedPorts(21, ...PASSIVE_PORTS)
            .withWaitStrategy(Wait.forHealthCheck())
            .start();

        controlPort = container.getMappedPort(21);
    });

    after(async function() {
        if (container) await container.stop();
    });

    function makeClient() {
        return new Client(15_000);
    }

    async function connectPlain(client) {
        return client.access({
            host: "127.0.0.1",
            port: controlPort,
            user: "ftpuser",
            password: "ftppassword"
        });
    }

    async function connectTLS(client) {
        return client.access({
            host: "127.0.0.1",
            port: controlPort,
            user: "ftpuser",
            password: "ftppassword",
            secure: true,
            secureOptions: { rejectUnauthorized: false }
        });
    }

    // Run the same suite against plain FTP and explicit FTPS.
    for (const [label, connect] of [
        ["plain FTP",            connectPlain],
        ["FTPS (explicit TLS)",  connectTLS],
    ]) {
        describe(label, function() {
            this.timeout(20_000);

            /** @type {Client} */
            let client;

            beforeEach(async function() {
                client = makeClient();
                await connect(client);
            });

            afterEach(async function() {
                // Best-effort cleanup: remove everything in the FTP root between tests.
                try {
                    const files = await client.list();
                    for (const f of files) {
                        if (f.isDirectory) await client.removeDir(f.name);
                        else               await client.remove(f.name);
                    }
                }
                catch (_) { /* ignore – client may be in a bad state after a failed test */ }
                client.close();
            });

            it("connects and reports server features", async function() {
                const response = await client.send("FEAT");
                assert.ok(response.code >= 200 && response.code < 300);
            });

            it("lists an empty home directory", async function() {
                const list = await client.list();
                assert.deepStrictEqual(list, []);
            });

            it("uploads and downloads a text file", async function() {
                const content = "Hello, ProFTPD integration test!";
                await client.uploadFrom(bufferReadable(content), "hello.txt");

                const writer = collectWritable();
                await client.downloadTo(writer, "hello.txt");

                assert.strictEqual(writer.data().toString("utf8"), content);
            });

            it("uploads and downloads binary content intact", async function() {
                const content = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]);
                await client.uploadFrom(bufferReadable(content), "binary.bin");

                const writer = collectWritable();
                await client.downloadTo(writer, "binary.bin");

                assert.ok(content.equals(writer.data()), "binary round-trip mismatch");
            });

            it("reports correct file size", async function() {
                const content = "size test content";
                await client.uploadFrom(bufferReadable(content), "sizefile.txt");

                const size = await client.size("sizefile.txt");
                assert.strictEqual(size, Buffer.byteLength(content, "utf8"));
            });

            it("lists uploaded files", async function() {
                await client.uploadFrom(bufferReadable("a"), "a.txt");
                await client.uploadFrom(bufferReadable("b"), "b.txt");

                const names = (await client.list()).map(f => f.name).sort();
                assert.deepStrictEqual(names, ["a.txt", "b.txt"]);
            });

            it("creates and removes a directory", async function() {
                await client.ensureDir("testdir");
                await client.cd("/");
                let list = await client.list();
                assert.ok(list.some(f => f.name === "testdir" && f.isDirectory), "dir not found after ensureDir");

                await client.removeDir("testdir");
                list = await client.list();
                assert.ok(!list.some(f => f.name === "testdir"), "dir still present after removeDir");
            });

            it("renames a file", async function() {
                await client.uploadFrom(bufferReadable("rename me"), "original.txt");
                await client.rename("original.txt", "renamed.txt");

                const names = (await client.list()).map(f => f.name);
                assert.ok(!names.includes("original.txt"), "original name still present");
                assert.ok(names.includes("renamed.txt"),   "new name not found");
            });

            it("removes a file", async function() {
                await client.uploadFrom(bufferReadable("delete me"), "deleteme.txt");
                await client.remove("deleteme.txt");

                const list = await client.list();
                assert.ok(!list.some(f => f.name === "deleteme.txt"), "file still present after remove");
            });

            it("creates nested directories with ensureDir", async function() {
                await client.ensureDir("a/b/c");
                await client.cd("/");

                const top = (await client.list()).map(f => f.name);
                assert.ok(top.includes("a"), "top-level dir missing");
            });

            it("handles large file upload and download", async function() {
                const content = Buffer.alloc(512 * 1024, 0x41); // 512 KB of 'A'
                await client.uploadFrom(bufferReadable(content), "large.bin");

                const size = await client.size("large.bin");
                assert.strictEqual(size, content.length);

                const writer = collectWritable();
                await client.downloadTo(writer, "large.bin");
                assert.ok(content.equals(writer.data()), "large file round-trip mismatch");
            });

            it("uploads and downloads 10 MB with byte-perfect integrity", async function() {
                this.timeout(60_000);
                const SIZE = 10 * 1024 * 1024;
                // Cycling 0–255 pattern: any truncation, padding, or single-byte
                // corruption produces a detectable offset in the pattern.
                const content = Buffer.allocUnsafe(SIZE);
                for (let i = 0; i < SIZE; i++) content[i] = i & 0xff;

                await client.uploadFrom(bufferReadable(content), "10mb.bin");

                assert.strictEqual(await client.size("10mb.bin"), SIZE, "server-side size mismatch");

                const writer = collectWritable();
                await client.downloadTo(writer, "10mb.bin");
                const downloaded = writer.data();

                assert.strictEqual(downloaded.length, SIZE, "downloaded length mismatch");
                assert.ok(content.equals(downloaded), "content mismatch – data corrupted in transit");
            });
        });
    }

    // ---------------------------------------------------------------------------
    // TLS 1.3 session ticket chain
    //
    // In TLS 1.3 the server issues single-use session tickets (PSK). basic-ftp
    // stores each ticket received on a data connection in `ftp.tlsSessionStore`
    // (transfer.ts:138) and presents it on the *next* data connection
    // (transfer.ts:133). If any link in that chain breaks every subsequent data
    // connection will fail because it will present an already-consumed ticket.
    //
    // This test forces TLS 1.3 (no fallback) and runs enough sequential data
    // connections to walk several full ticket-rotation cycles.
    // ---------------------------------------------------------------------------

    describe("TLS 1.3 session ticket chain", function() {
        this.timeout(30_000);

        it("rotates tickets correctly across many data connections", async function() {
            const client = makeClient();
            try {
                await client.access({
                    host: "127.0.0.1",
                    port: controlPort,
                    user: "ftpuser",
                    password: "ftppassword",
                    secure: true,
                    secureOptions: {
                        rejectUnauthorized: false,
                        minVersion: "TLSv1.3",
                        maxVersion: "TLSv1.3",
                    }
                });

                // Confirm the control channel actually negotiated TLS 1.3 –
                // if the handshake fell back to 1.2 the test would be vacuous.
                assert.strictEqual(
                    client.ftp.socket.getProtocol(),
                    "TLSv1.3",
                    "control channel must use TLS 1.3"
                );

                // 4 rounds × (upload + download) + 1 final list = 9 data connections.
                // Each connection must present the ticket that the *previous* one
                // received, so this walks four full ticket-rotation cycles.
                const ROUNDS = 4;
                for (let i = 1; i <= ROUNDS; i++) {
                    const payload = `round-${i} `.repeat(100); // ~800 B, non-trivial size

                    await client.uploadFrom(bufferReadable(payload), `ticket-test-${i}.txt`);

                    const writer = collectWritable();
                    await client.downloadTo(writer, `ticket-test-${i}.txt`);

                    assert.strictEqual(
                        writer.data().toString("utf8"),
                        payload,
                        `data integrity failure on round ${i}`
                    );
                }

                // One last data connection (LIST) after all the ticket rotations.
                const names = (await client.list()).map(f => f.name).sort();
                assert.deepStrictEqual(
                    names,
                    Array.from({ length: ROUNDS }, (_, i) => `ticket-test-${i + 1}.txt`)
                );
            }
            finally {
                try {
                    for (let i = 1; i <= 4; i++) await client.remove(`ticket-test-${i}.txt`);
                } catch (_) {}
                client.close();
            }
        });
    });
});
