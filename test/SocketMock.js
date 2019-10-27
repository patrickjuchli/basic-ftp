const EventEmitter = require("events");

let counter = 0;

module.exports = class SocketMock extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.bytesWritten = 0;
        this.bytesRead = 0;
        this.timeout = -1;
        this.remoteAddress = undefined
        this.localPort = ++counter
    }
    connect() {
        this.remoteAddress = "somewhere"
    }
    setEncoding(encoding) {
        return this
    }
    removeAllListeners() {
        return this
    }
    setKeepAlive() {
    }
    setTimeout(millis) {
        this.timeout = millis;
    }
    destroy() {
        this.destroyed = true;
    }
    write(buf) {
        this.emit("didSend", buf);
    }
    end() {
        this.emit("data", null);
        this.destroyed = true;
    }
    pipe(target) {
        this.on("data", chunk => chunk ? target.write(chunk) : target.end());
    }
};