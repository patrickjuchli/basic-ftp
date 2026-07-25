const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const tls = require("tls");
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

// Minimal implicit-FTPS server: completes the TLS handshake and greets with 220.
class ImplicitTlsServer {
    constructor() {
        this.server = tls.createServer({ key: KEY, cert: CERT }, socket => {
            socket.write("220 Welcome\r\n");
        });
    }
    listen() {
        return new Promise(resolve => this.server.listen(0, "127.0.0.1", resolve));
    }
    get address() {
        return this.server.address();
    }
    close() {
        this.server.close();
    }
}

describe("Implicit TLS", () => {

    let server, client;

    beforeEach(async () => {
        server = new ImplicitTlsServer();
        await server.listen();
        client = new Client(1000);
    });

    afterEach(() => {
        client.close();
        server.close();
    });

    // Regression for the Node.js v24.17.0 (CVE-2026-48934) change that binds a
    // reusable TLS session to the host it was authenticated for. Data connections
    // reuse the control connection's session, so the control host identity must be
    // remembered on `tlsOptions`; otherwise data connections resume under a
    // different identity and servers report the session as not resumed.
    it("remembers the control host on tlsOptions so data connections can resume the session", async () => {
        await client.connectImplicitTLS("127.0.0.1", server.address.port, { ca: CERT, rejectUnauthorized: true });
        assert.strictEqual(client.ftp.tlsOptions.host, "127.0.0.1");
    });

    it("does not overwrite a host explicitly provided in secureOptions", async () => {
        await client.connectImplicitTLS("127.0.0.1", server.address.port, { ca: CERT, rejectUnauthorized: true, host: "localhost" });
        assert.strictEqual(client.ftp.tlsOptions.host, "localhost");
    });
});
