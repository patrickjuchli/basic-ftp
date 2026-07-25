const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const crypto = require("crypto");
const tls = require("tls");
const { Readable } = require("stream");
const { Client } = require("../dist");

// Self-signed cert for 127.0.0.1 / localhost, used only by these tests.
const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDHft4AIbaI7wwQ
Cyoe71a2+x9gRawzwRefPC8SepL65/sU9Ch+j5E22YRYixLCLAFvWCxyM8gjYtt9
gtbGdDk2ce/TbRXvctC+QUpMxPDRlV+yaq5PPxYSmTPf+pRbttpwXSB//miNHs05
B2xY9umWcdiqWz0epyveVUWihIoqbWQ7g35JXalYTZIoVf1dd7L9nfoXYE8PnrAb
bW6p7OvUfJOzwo+SQW9MA6jJPtK1plnNWMOkzs9LiCL/x3myr68yZPVub9JRYbny
0Gldnxa+exxqc53IJ8qDd/jXzgZhZKnMVPM2R0GWDGA/wTQzs4tE6FqTB+IXU93f
d5Aj+LHXAgMBAAECggEAUN8x0NzZ2f4KJlDYVO0SeqAnsofcDKj40gD8ViHhhpxX
MUHfTpsVs6YPHDPYuWVMeZ5FelBakFnJf8J0HcRM0zDyF4QP0d96Fr5yB9gIhfXn
cvUDT7XT1VtM5731uY5RVB60h56TNK4pZLaJKjGCNQ5W1oyhJNWBF6L61SyktBin
nxD6nOax6QyvPpVom1khzPVx6oNp3sOHgBLK/0+qwpfWk3lcrM7FsDI2pYgmCcHO
VzI0zmbBnxbjrfJrNnXfHMX4WPhPj0vwQv/CwCWS6y9MZIowe6TTUGxEiex74dYV
DMoVo8phvk1IstffzQR7u46XM6Mb8RbTQGqFNRo3WQKBgQD1kHh7MAYa1Sz3+MNA
hBD6O30XKQPhIK+dQKd3xA16B6KTZOUtSO5SuULC6h3SsBzzI2c3nzxD9fQWeob/
huLl2r2cpmJ7VIjQAp+5A7KYsWdPbPtB/wCYRfNwrQs74/TnH3pjGMvaFZ8y7xOc
6RPfExNFsTMagrLe4nb9jxXpbwKBgQDP+TU60vzio+wH+o9oG/aaQBmkOe/At8eC
3Ya8/Yqq8+AwyuXXvt9ozXmoK8Y4YLF2CHETwr4VZKdKAOcadGe3LW2+HMnA92N9
sdicMamDWSokA0yNxy82swVlp4o3Tyaz4XClhH5kHiLJ0u4FBAnba2ON9EamesX8
FyRB+Mp6GQKBgA9w8zKD1Y5wYzCAkv6Gj268uOPw706DuKdBvoYYbOSEgGOWT5bm
ZB4NijYpdJCgBGIBkub7e1WmrJ+ROtXsjG35sDyedcjdivDRiWuf4OYbGazz5GTE
/SuWEnW+W9t7PRYfc5mxoHfpLiaMxAX03gwD7g1O1DDRkR/Uy7ir+6u/AoGAORUp
qw+mIX7klfwLyIOEWCon34+XYsoOlLjA9raQjQOLEVlfZKwbHeTn82Swb2D61G7U
upvFGJIb6I/+3p/8p6ZsbLXyGmjMgf+CeLyYzlh23JObO37kUpsobBJkOXIcKVtD
U+rd1hT/b23Zrr7BBdyf4qKdkaw5E0w2w3TJ/mECgYAPNzz7Y42rn1N024MxRBd4
AjaWRn4G1IslC3Xkcb2t5KALYQCEkb1q51wsSyHbQqXAvo+y7OyNdXByax51cDUm
xnRep4AnNHlkFYYLQlrFaY4VeF6zOwqjp7JeyqkACb6lRg596/AQepc9av+uuIuN
hWKE6tBe59J89Tn5oT9j2g==
-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUbcOuRZvszwe8X7aeLcUz4paZwpswDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDcyNTA3NTMwMVoYDzIxMjYw
NzAxMDc1MzAxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDHft4AIbaI7wwQCyoe71a2+x9gRawzwRefPC8SepL6
5/sU9Ch+j5E22YRYixLCLAFvWCxyM8gjYtt9gtbGdDk2ce/TbRXvctC+QUpMxPDR
lV+yaq5PPxYSmTPf+pRbttpwXSB//miNHs05B2xY9umWcdiqWz0epyveVUWihIoq
bWQ7g35JXalYTZIoVf1dd7L9nfoXYE8PnrAbbW6p7OvUfJOzwo+SQW9MA6jJPtK1
plnNWMOkzs9LiCL/x3myr68yZPVub9JRYbny0Gldnxa+exxqc53IJ8qDd/jXzgZh
ZKnMVPM2R0GWDGA/wTQzs4tE6FqTB+IXU93fd5Aj+LHXAgMBAAGjbzBtMB0GA1Ud
DgQWBBQrsDkPyngvK2f8Po69lZvZR2tc+TAfBgNVHSMEGDAWgBQrsDkPyngvK2f8
Po69lZvZR2tc+TAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGHBH8AAAGCCWxv
Y2FsaG9zdDANBgkqhkiG9w0BAQsFAAOCAQEAKyl5Xu7qjsERZBNfeQxpfYoU7KPR
fpTlO9EGUR5nWVCZ85pypec5Tzia8ht3PCt4vnd5/34U4YgTlDx+Go9SjXj9qpTE
ePBxEGzilk0eh9m9dUS0wCrY5AfB49975grrauu7SDt5jt+PU54RD5w7kgUcaKBV
9c7+sEK4It+McB7aSENBb9T7EJt7K9iSmFN1UZ+G3OKhSjkmUsZIYFI/L2vlJEO6
iLWmv6CVrkpClaaXbmDTcRh546NN9yIi4RuCkwwOMDMzLIx0a0+Unxivx5w/Z70u
9LL82ZNYQY//ypFbx/UBlYbovgR/4+0VuqdLyDe3SrBrsz7AtNvDLUtQKA==
-----END CERTIFICATE-----`;

// Minimal implicit-FTPS server that REQUIRES the data connection to resume the
// control connection's TLS session — the behaviour of FileZilla Server and of
// ProFTPD without NoSessionReuseRequired. The control and data listeners share
// TLS ticket keys so a correctly-presented session resumes across them; if the
// data connection did NOT resume (server-side isSessionReused() === false) the
// STOR is rejected with 425, exactly as a real server reports it.
//
// This lets a plain `node --test` run reproduce the CVE-2026-48934 regression:
// on an affected runtime (Node 22.23.0+, 24.17.0+, 26.3.1+) an unpinned data
// connection falls back to a "localhost" identity that doesn't match the
// control's "127.0.0.1", so Node refuses to resume, the server answers 425 and
// the upload rejects. connectImplicitTLS() pinning the host fixes it.
class ImplicitReuseServer {
    constructor() {
        const tlsOptions = { key: KEY, cert: CERT, ticketKeys: crypto.randomBytes(48) };
        this.lastDataReused = null;
        this._pending = null;
        this.controlServer = tls.createServer(tlsOptions, sock => this._handleControl(sock));
        this.dataServer = tls.createServer(tlsOptions, sock => this._handleData(sock));
    }

    listen() {
        return Promise.all([
            new Promise(r => this.controlServer.listen(0, "127.0.0.1", r)),
            new Promise(r => this.dataServer.listen(0, "127.0.0.1", r)),
        ]);
    }

    get port() { return this.controlServer.address().port; }
    get dataPort() { return this.dataServer.address().port; }

    close() {
        this.controlServer.close();
        this.dataServer.close();
    }

    _handleData(sock) {
        const state = this._pending;
        const reused = sock.isSessionReused();
        this.lastDataReused = reused;
        if (state) {
            state.dataSocket = sock;
            state.dataReused = reused;
        }
        sock.on("data", () => {});
        sock.on("end", () => { if (state) { state.dataEnded = true; if (state.onEnd) state.onEnd(); } });
        sock.on("error", () => {});
    }

    _handleControl(control) {
        const state = { dataSocket: null, dataReused: null, dataEnded: false, onEnd: null };
        this._pending = state;
        control.on("error", () => {});
        control.write("220 Welcome\r\n");
        let buffer = "";
        control.on("data", chunk => {
            buffer += chunk.toString("latin1");
            let idx;
            while ((idx = buffer.indexOf("\r\n")) >= 0) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                this._onCommand(control, line, state);
            }
        });
    }

    _onCommand(control, line, state) {
        const cmd = line.split(" ")[0].toUpperCase();
        switch (cmd) {
            case "USER": control.write("331 Need password\r\n"); break;
            case "PASS": control.write("230 Logged in\r\n"); break;
            case "FEAT": control.write("211 End\r\n"); break;
            case "TYPE": case "STRU": case "PBSZ": case "PROT": case "OPTS":
                control.write("200 OK\r\n"); break;
            case "EPSV":
                control.write(`229 Entering Extended Passive Mode (|||${this.dataPort}|)\r\n`); break;
            case "STOR": this._handleStor(control, state); break;
            case "QUIT": control.write("221 Bye\r\n"); break;
            default: control.write("500 Unknown command\r\n");
        }
    }

    _handleStor(control, state) {
        const proceed = () => {
            if (!state.dataReused) {
                // The core of the test: a non-resumed data connection is rejected.
                control.write("425 Unable to build data connection: TLS session of data connection not resumed.\r\n");
                if (state.dataSocket) state.dataSocket.destroy();
                return;
            }
            control.write("150 Opening data connection\r\n");
            const finish = () => control.write("226 Transfer complete\r\n");
            if (state.dataEnded) finish();
            else state.onEnd = finish;
        };
        // The data connection is opened during prepareTransfer, before STOR, but
        // guard against ordering races on slower machines.
        if (state.dataSocket) proceed();
        else {
            const timer = setInterval(() => {
                if (state.dataSocket) { clearInterval(timer); proceed(); }
            }, 5);
        }
    }
}

describe("Implicit TLS data-connection session reuse", () => {

    let server, client;

    beforeEach(async () => {
        server = new ImplicitReuseServer();
        await server.listen();
        client = new Client(4000);
    });

    afterEach(() => {
        client.close();
        server.close();
    });

    // Regression guard for CVE-2026-48934. On affected Node runtimes this upload
    // rejects with 425 unless connectImplicitTLS() pins the control host so the
    // data connection resumes the session. On unaffected runtimes (e.g. the EOL
    // 25.x line) resumption happens anyway and this simply passes.
    it("resumes the control session on the data connection (upload succeeds)", async () => {
        await client.access({
            host: "127.0.0.1",
            port: server.port,
            user: "test",
            password: "test",
            secure: "implicit",
            secureOptions: { rejectUnauthorized: false }
        });

        await assert.doesNotReject(
            () => client.uploadFrom(Readable.from(["hello reuse"]), "reuse-test.txt"),
            "upload must not be rejected — the data connection has to resume the TLS session"
        );

        assert.strictEqual(
            server.lastDataReused,
            true,
            "server must observe the data connection as a resumed TLS session"
        );
    });
});
