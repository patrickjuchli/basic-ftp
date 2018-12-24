"use strict";

class FTPError extends Error {
    static prependIdentifier(err, identifier) {
        // Did we already do this?
        if (/^\(\w+ socket\)/.test(err.message)) return err;

        if (identifier) err.message = `(${identifier} socket) ${err.message}`;
        return err;
    }

    /**
    * @param {String} message
    * @param {Object} [options] Optional properties, as follows:
    * @param {String} [options.identifier] 'data' or 'channel' to identify socket
    * @param {Number} [options.code] FTP error code
    */
    constructor(message, options) {
      super(message)
      if (options) {
        FTPError.prependIdentifier(this, options.identifier);
        if (options.code != null)  this.code = options.code;
      }
    }
}

module.exports = FTPError;
