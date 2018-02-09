const EventEmitter = require("events");

module.exports = class SocketMock extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
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
}