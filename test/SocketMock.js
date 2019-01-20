const EventEmitter = require("events");

module.exports = class SocketMock extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        this.bytesWritten = 0;
        this.bytesRead = 0;
        this.timeout = -1;
    }
    setEncoding() {
    }
    removeAllListeners() {
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
        this.emit("end");
        this.destroyed = true;
    }
    pipe(target) {
        this.on("data", chunk => target.write(chunk));
    }
};