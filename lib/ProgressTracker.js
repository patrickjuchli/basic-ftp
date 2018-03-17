"use strict";

/**
 * @typedef {Object} ProgressInfo
 * @property {string} name  A name describing this info, e.g. the filename of the transfer.
 * @property {string} type  The type of transfer, typically "upload" or "download".
 * @property {number} bytes  Transferred bytes in current transfer.
 * @property {number} bytesOverall  Transferred bytes since last counter reset. Useful for tracking multiple transfers.
 */

/**
 * Tracks and reports progress of one socket data transfer at a time.
 */
module.exports = class ProgressTracker {

    constructor() {
        this.bytesOverall = 0;
        this.intervalMillis = 500;
        /** @type {((stopWithUpdate: boolean) => void)} */
        this._stop = noop;
        /** @type {((info: ProgressInfo) => void)} */
        this._handler = noop;
    }

    /**
     * Register a new handler for progress info. Use `undefined` to disable reporting.
     * 
     * @param {((info: ProgressInfo) => void)} [handler] 
     */
    reportTo(handler = () => {}) {
        this._handler = handler;
    }

    /**
     * Start tracking transfer progress of a socket.
     * 
     * @param {Socket} socket  The socket to observe.
     * @param {string} name  A name associated with this progress tracking, e.g. a filename.
     * @param {string} type  The type of the transfer, typically "upload" or "download".
     */
    start(socket, name, type) {
        let lastBytes = 0;
        this._stop = poll(this.intervalMillis, () => {
            const bytes = socket.bytesRead + socket.bytesWritten;
            this.bytesOverall += bytes - lastBytes;
            lastBytes = bytes;
            this._handler({
                name,
                type,
                bytes,
                bytesOverall: this.bytesOverall
            }); 
        });
    }

    /**
     * Stop tracking transfer progress.
     */
    stop() {
        this._stop(false);
    }

    /**
     * Call the progress handler one more time, then stop tracking.
     */
    updateAndStop() {
        this._stop(true);
    }
};

/**
 * Starts calling a callback function at a regular interval. The first call will go out
 * immediately. The function returns a function to stop the polling.
 * 
 * @param {number} intervalMillis 
 * @param {(() => any)} cb
 * @return {((stopWithUpdate: boolean) => void)}
 */
function poll(intervalMillis, cb) {
    let handler = cb;
    const stop = stopWithUpdate => {
        clearInterval(id);
        if (stopWithUpdate) {
            handler();
        }
        handler = noop; // Prevent repeated calls to stop calling handler.
    };
    const id = setInterval(handler, intervalMillis);
    handler();
    return stop;
}

function noop() { /*Do nothing*/ }
