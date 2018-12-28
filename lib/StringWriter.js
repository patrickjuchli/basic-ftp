"use strict";

const EventEmitter = require("events");

/**
 * Collect binary data chunks.
 */
module.exports = class StringWriter extends EventEmitter {

    constructor() {
        super();
        /**
         * Data collected.
         * @private
         * @type {Buffer}
         */
        this._buffer = Buffer.alloc(0);
        this.write = this.end = this.append;
    }

    getText(encoding) {
        return this._buffer.toString(encoding);
    }

    append(chunk) {
        if (chunk) {
            this._buffer = Buffer.concat([this._buffer, chunk]);
        }
    }
};
