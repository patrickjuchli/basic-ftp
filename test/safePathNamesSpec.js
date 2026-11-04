const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { Client, FileInfo, FileType } = require("../dist")
const { isSafePathName } = require("../dist/safePathNames")
const MockFtpServer = require("./MockFtpServer")

const UNSAFE_EVERYWHERE = ["", ".", "..", "/", "/etc", "a/b", "../x", undefined]
const UNSAFE_ON_WINDOWS = ["\\", "a\\b", "..\\x", "C:\\x", "\\\\server\\share", "C:", "D:", "C:x", "a:b", ".. ", "...", ". ", "  "]
const SAFE = ["file.txt", ".hidden", "..x", "x..y", "x.", " leading space", "名前"]

describe("Safe path names", () => {

    for (const name of UNSAFE_EVERYWHERE) {
        it(`rejects ${JSON.stringify(name)} on all platforms`, () => {
            assert.strictEqual(isSafePathName(name, path.posix), false)
            assert.strictEqual(isSafePathName(name, path.win32), false)
        })
    }

    for (const name of UNSAFE_ON_WINDOWS) {
        it(`rejects ${JSON.stringify(name)} only on Windows`, () => {
            assert.strictEqual(isSafePathName(name, path.win32), false)
            assert.strictEqual(isSafePathName(name, path.posix), true)
        })
    }

    for (const name of SAFE) {
        it(`accepts ${JSON.stringify(name)}`, () => {
            assert.strictEqual(isSafePathName(name, path.posix), true)
            assert.strictEqual(isSafePathName(name, path.win32), true)
        })
    }

    // Callers join an accepted name with a directory path. Make sure that always yields a direct child.
    const accepted = [
        [path.posix, ["/home/user/downloads", "downloads", ".", "/"], [...SAFE, ...UNSAFE_ON_WINDOWS]],
        [path.win32, ["C:\\dl", "dl", ".", "C:\\", "\\\\server\\share\\dl"], SAFE],
    ]
    for (const [localPath, dirs, names] of accepted) {
        it(`joins accepted names as direct children for ${localPath === path.win32 ? "Windows" : "POSIX"}`, () => {
            for (const dir of dirs) {
                for (const name of names) {
                    assert.strictEqual(isSafePathName(name, localPath), true)
                    const resolvedDir = localPath.resolve(dir)
                    const child = localPath.resolve(localPath.join(dir, name))
                    assert.strictEqual(localPath.dirname(child), resolvedDir, `${dir} + ${name}`)
                    assert.strictEqual(localPath.basename(child), name, `${dir} + ${name}`)
                }
            }
        })
    }
})

function entry(name, type) {
    const info = new FileInfo(name)
    info.type = type
    return info
}

/**
 * A custom `parseList` lets names through that the built-in parsers would filter out. Following an
 * unsafe directory would download the next listing outside of the target directory.
 */
describe("Download a directory with unsafe names in the listing", () => {

    let client, server, tmp, target, listings

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "basic-ftp-"))
        target = path.join(tmp, "target")
        listings = []
        client = new Client(1000)
        client.parseList = () => listings.shift() || []
        server = new MockFtpServer()
        const sendData = (payload) => {
            setTimeout(() => {
                server.dataConn.write(payload)
                server.dataConn.end()
            })
            return "150 Ready"
        }
        server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${server.dataAddressForPasvResponse})`,
            "pwd": () => `257 "/root"`,
            "cwd": () => "250 OK",
            "cdup": () => "250 OK",
            "list": () => sendData("listing"),
            "retr": () => sendData("content"),
        })
        return client.access({ port: server.ctrlAddress.port, user: "test", password: "test" })
    })

    afterEach(() => {
        client.close()
        server.close()
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    function assertOnlySafeFileDownloaded() {
        assert.deepStrictEqual(fs.readdirSync(tmp), ["target"])
        assert.deepStrictEqual(fs.readdirSync(target), ["ok.txt"])
    }

    for (const name of ["..", ".", ""]) {
        it(`skips the directory ${JSON.stringify(name)}`, async () => {
            listings = [
                [entry(name, FileType.Directory), entry("ok.txt", FileType.File)],
                [entry("escaped.txt", FileType.File)],
            ]
            await client.downloadToDir(target)
            assertOnlySafeFileDownloaded()
        })
    }

    it("skips files named with a path", async () => {
        listings = [[
            entry("../escaped.txt", FileType.File),
            entry(path.join(tmp, "escaped.txt"), FileType.File),
            entry("ok.txt", FileType.File),
        ]]
        await client.downloadToDir(target)
        assertOnlySafeFileDownloaded()
    })
})
