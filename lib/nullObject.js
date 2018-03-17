"use strict";

/**
 * Get an object that will let you call any method by any name. These methods won't 
 * do anything and will always return `undefined`.
 */
module.exports = () => new Proxy({}, {
    get() {
        return noop;
    }
});

function noop() { /*Do Nothing*/ }
