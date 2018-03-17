const EventEmitter = require("events");

module.exports = class SocketMock extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.bytesWritten = 0;
        this.bytesRead = 0;
    }
    removeAllListeners() {
    }
    setKeepAlive() {
    }
    setTimeout() {
    }
    destroy() {
        this.destroyed = true;
    }
    write(buf) {
        this.emit("didSend", buf);
    }
    end() {
        this.emit("end");
        this.destroyed = true;
    }
    pipe(target) {
        this.on("data", chunk => target.write(chunk));
    }
}