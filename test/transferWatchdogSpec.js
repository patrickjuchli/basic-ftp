const { describe, it, afterEach } = require("node:test");
const assert = require("assert");
const { TransferWatchdog } = require("../dist/TransferWatchdog");

const TIMEOUT = 50
// Long enough for the watchdog to have reported a stall if it was going to.
const WAIT = TIMEOUT * 5

/**
 * A stand-in for a data socket, offering only what the watchdog looks at.
 */
function socketMock({ paused = false, queued = 0 } = {}) {
    return {
        bytesRead: 0,
        bytesWritten: 0,
        writableLength: queued,
        isPaused: () => paused
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

describe("TransferWatchdog", () => {

    const watchdog = new TransferWatchdog()

    /**
     * Start watching `socket`, counting the stalls reported from now on.
     */
    function watch(socket, direction, timeout = TIMEOUT) {
        const report = { stalls: 0 }
        watchdog.start(socket, direction, timeout, () => { report.stalls += 1 })
        return report
    }

    /**
     * Watch `socket` and return whether a stall was reported before `WAIT` elapsed.
     */
    async function reportsStall(socket, direction, timeout = TIMEOUT) {
        const report = watch(socket, direction, timeout)
        await wait(WAIT)
        return report.stalls > 0
    }

    afterEach(() => watchdog.stop())

    it("reports a download that receives nothing", async () => {
        assert.strictEqual(await reportsStall(socketMock(), "download"), true)
    })

    it("ignores a download that is paused by its destination", async () => {
        assert.strictEqual(await reportsStall(socketMock({ paused: true }), "download"), false)
    })

    it("reports an upload the server stopped accepting", async () => {
        assert.strictEqual(await reportsStall(socketMock({ queued: 1024 }), "upload"), true)
    })

    it("ignores an upload waiting for its source", async () => {
        assert.strictEqual(await reportsStall(socketMock({ queued: 0 }), "upload"), false)
    })

    it("ignores a connection that keeps making progress", async () => {
        const socket = socketMock()
        const transfer = setInterval(() => { socket.bytesRead += 100 }, TIMEOUT / 2)
        try {
            assert.strictEqual(await reportsStall(socket, "download"), false)
        } finally {
            clearInterval(transfer)
        }
    })

    it("reports a connection that stops making progress", async () => {
        const socket = socketMock()
        const report = watch(socket, "download")
        const transfer = setInterval(() => { socket.bytesRead += 100 }, TIMEOUT / 2)
        await wait(WAIT)
        assert.strictEqual(report.stalls, 0, "no stall while data is flowing")
        clearInterval(transfer)
        await wait(WAIT)
        assert.ok(report.stalls > 0, "stall after data stopped flowing")
    })

    // A transfer can look idle for a moment without being stalled, for example right after its
    // destination signalled that it can accept data again but before the next bytes arrived.
    // Basing a stall on a single observation would turn such a moment into a failed transfer.
    it("checks repeatedly before reporting a stall", async () => {
        let checks = 0
        const socket = socketMock()
        socket.isPaused = () => { checks += 1; return false }
        const report = watch(socket, "download")
        await wait(WAIT)
        assert.strictEqual(report.stalls, 1, "reported a stall")
        assert.ok(checks >= 4, `stall was based on ${checks} check(s)`)
    })

    // Our own backpressure closes the receive window. The server only learns that it reopened
    // with its next probe, which it spaces out further the longer it has been waiting, so it can
    // stay silent well past the timeout through no fault of its own.
    it("waits longer for a server that we made wait ourselves", async () => {
        const socket = socketMock({ paused: true })
        const report = watch(socket, "download")
        await wait(WAIT)
        assert.strictEqual(report.stalls, 0, "no stall while our destination is holding up the transfer")
        socket.isPaused = () => false
        await wait(TIMEOUT * 1.5)
        assert.strictEqual(report.stalls, 0, "no stall while the server is recovering from our pause")
        await wait(WAIT)
        assert.ok(report.stalls > 0, "stall once the server stayed silent beyond that")
    })

    it("stops granting extra time once the server responded", async () => {
        const socket = socketMock({ paused: true })
        const report = watch(socket, "download")
        await wait(TIMEOUT)
        socket.isPaused = () => false
        socket.bytesRead += 100 // the server picked up again
        await wait(WAIT)
        assert.ok(report.stalls > 0, "a server going silent afterwards stalls after the plain timeout")
    })

    it("is disabled with a timeout of 0", async () => {
        assert.strictEqual(await reportsStall(socketMock(), "download", 0), false)
    })

    it("reports nothing after being stopped", async () => {
        const report = watch(socketMock(), "download")
        watchdog.stop()
        await wait(WAIT)
        assert.strictEqual(report.stalls, 0)
    })

    it("reports a stall only once", async () => {
        const report = watch(socketMock(), "download")
        await wait(WAIT)
        assert.strictEqual(report.stalls, 1)
    })

    it("forgets the previous transfer when started again", async () => {
        const report = watch(socketMock(), "download")
        assert.strictEqual(await reportsStall(socketMock({ paused: true }), "download"), false)
        assert.strictEqual(report.stalls, 0, "previous transfer is no longer watched")
    })
})
