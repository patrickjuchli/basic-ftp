"use strict";

/**
 * Tracks and reports progress of data transferred over a socket.
 */
module.exports = class ProgressTracker {

    constructor() {
        this.overall = 0;
        this.handler = () => {};
    }

    observe(socket, info = "") {
        let id = 0;
        let last = 0;
        const update = () => {
            const current = socket.bytesRead + socket.bytesWritten;
            this.overall += current - last;
            this.handler(current, info, this.overall);
            last = current;
        };
        const start = () => {
            id = setInterval(update, 500);
            update();                
        }
        const stop = () => {
            clearInterval(id);
            update();               
        }
        socket.once("pipe", start)
        socket.once("data", start)
        socket.once("finish", stop);
        socket.once("error", stop);
        socket.once("timeout", stop);
    }

    reportTo(handler = () => {}) {
        this.overall = 0;
        this.handler = handler;
    }
}

    // /**
    //  * Track progress with a given handler function. Pass `undefined` to unregister any handler.
    //  * Calling this method will also reset the overall transfer counter to 0.
    //  * 
    //  * @param {((current: number, info: string, overall: number) => void)} handler 
    //  */
    // trackProgress(handler) {
    //     this._tracker.reportTo(handler);
    // }