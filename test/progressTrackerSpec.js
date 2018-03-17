const assert = require("assert");
const ProgressTracker = require("../lib/ProgressTracker");
const SocketMock = require("./SocketMock");

describe("ProgressTracker", function() {
    this.timeout(100);
    
    let socket, tracker;
    beforeEach(function() {
        socket = new SocketMock();
        tracker = new ProgressTracker();
    });

    it("calls update directly on start", function(done) {
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 0,
                bytesOverall: 0,
                name: "name",
                type: "type"
            }, "Initial values");
            done();
        });
        tracker.start(socket, "name", "type");
        tracker.stop();
    });

    it("can stop without update on more time", function() {
        tracker.start(socket);
        tracker.reportTo(info => {
            assert.fail("This update should not be called.");
        });
        tracker.stop();
    });

    it("can call update one more time on stop", function(done) {
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 0,
                bytesOverall: 0,
                name: "name",
                type: "type"
            }, "Final values");
            done();
        });
        tracker.updateAndStop();        
    });

    it("reports correct values at stop after no intermediate updates", function(done) {
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                bytes: 5,
                bytesOverall: 5,
                name: "name",
                type: "type"
            }, "Final values");
            done();
        });
        socket.bytesWritten = 2;
        socket.bytesRead = 3;
        tracker.updateAndStop();                
    });

    it("does progress reports at an interval", function(done) {
        tracker.intervalMillis = 0;
        tracker.start(socket, "name", "type");
        let count = 0;
        tracker.reportTo(info => {
            assert.deepEqual(info, {
                name: "name",
                type: "type",
                bytes: count,
                bytesOverall: count
            }, "Progress info")
            socket.bytesWritten += 1;
            if (++count === 3) {
                tracker.reportTo();
                tracker.stop();
                done();
            }
        });
    });

    it("counts overall count over multiple start/stop blocks", function(done) {
        socket.bytesWritten = 1;
        tracker.start(socket, "name", "type");
        tracker.stop();
        socket.bytesWritten = 1;
        tracker.start(socket, "name", "type");
        tracker.reportTo(info => {
            assert.deepEqual(info.bytesOverall, 2);
            done();
        });
        tracker.updateAndStop();
    });

    it("can stop within the callback", function() {
        let firstTime = true;
        tracker.reportTo(info => {
            // Will be called on start
            tracker.reportTo();
            assert(firstTime, "Should not be called twice.");
            firstTime = false;
        })
        tracker.start(socket);
        tracker.updateAndStop();
    });
});