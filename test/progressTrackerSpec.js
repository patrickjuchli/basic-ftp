const { describe, it, beforeEach } = require("node:test");
const assert = require("assert");
const { ProgressTracker } = require("../dist/ProgressTracker");
const SocketMock = require("./SocketMock");

describe("ProgressTracker", { timeout: 100 }, () => {
    let tracker = new ProgressTracker()
    let socket;
    beforeEach(() => {
        socket = new SocketMock();
        tracker = new ProgressTracker();
    });

    it("calls update directly on start", () => new Promise(resolve => {
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 0,
                bytesOverall: 0,
                name: "name",
                type: "type"
            }, "Initial values");
            resolve();
        });
        tracker.start(socket, "name", "type");
        tracker.stop();
    }));

    it("can stop without update on more time", () => {
        tracker.start(socket, "", "");
        tracker.reportTo(() => {
            assert.fail("This update should not be called.");
        });
        tracker.stop();
    });

    it("can call update one more time on stop", () => new Promise(resolve => {
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 0,
                bytesOverall: 0,
                name: "name",
                type: "type"
            }, "Final values");
            resolve();
        });
        tracker.updateAndStop();
    }));

    it("reports correct values at stop after no intermediate updates", () => new Promise(resolve => {
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 5,
                bytesOverall: 5,
                name: "name",
                type: "type"
            }, "Final values");
            resolve();
        });
        socket.bytesWritten = 2;
        socket.bytesRead = 3;
        tracker.updateAndStop();
    }));

    it("does progress reports at an interval", () => new Promise(resolve => {
        tracker.intervalMs = 0;
        tracker.start(socket, "name", "type");
        let count = 0;
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                name: "name",
                type: "type",
                bytes: count,
                bytesOverall: count
            }, "Progress info");
            socket.bytesWritten += 1;
            if (++count === 3) {
                tracker.reportTo();
                tracker.stop();
                resolve();
            }
        });
    }));

    it("counts overall count over multiple start/stop blocks", () => new Promise(resolve => {
        socket.bytesWritten = 1;
        tracker.start(socket, "name", "type");
        tracker.stop();
        socket.bytesWritten = 1;
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info.bytesOverall, 2);
            resolve();
        });
        tracker.updateAndStop();
    }));

    it("can stop within the callback", () => {
        let firstTime = true;
        tracker.reportTo(() => {
            // Will be called on start
            tracker.reportTo();
            assert(firstTime, "Should not be called twice.");
            firstTime = false;
        });
        tracker.start(socket, "", "");
        tracker.updateAndStop();
    });
});
