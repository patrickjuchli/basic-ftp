"use strict";

const EventEmitter = require("events");

/**
 * Collect binary data chunks as a string.
 */
module.exports = class StringWriter extends EventEmitter {
    
    constructor(encoding) {
        super();
        this.encoding = encoding;
        this.text = "";
        this.write = this.end = this.append;
    }

    append(chunk) {
        if (chunk) {
            this.text += chunk.toString(this.encoding);
        }
    }
};
