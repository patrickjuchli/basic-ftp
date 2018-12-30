"use strict";

const Socket = require("net").Socket;
const parseControlResponse = require("./parseControlResponse");

/**
 * @typedef {Object} Task
 * @property {(...args: any[]) => void} resolve - Resolves the task.
 * @property {(err: Error) => void} reject - Rejects the task.
 */

/**
 * @typedef {Object} FTPResponse
 * @property {number} code - FTP response code
 * @property {string} message - FTP response including code
 */

/**
 * @typedef {(err: Error | undefined, response: FTPResponse | undefined, task: Task) => void} ResponseHandler
 */

/**
 * Describes an FTP server error response including the FTP response code.
 */
class FTPError extends Error {

    /**
     * @param {FTPResponse} res
     */
    constructor(res) {
        super(res.message);
        this.code = res.code;
    }

    get name() {
        return this.constructor.name;
    }
}
exports.FTPError = FTPError;

/**
 * FTPContext holds the control and data sockets of an FTP connection and provides a
 * simplified way to interact with an FTP server, handle responses, errors and timeouts.
 *
 * It doesn't implement or use any FTP commands. It's only a foundation to make writing an FTP
 * client as easy as possible. You won't usually instantiate this, but use `Client`.
 */
exports.FTPContext = class FTPContext {

    /**
     * Instantiate an FTP context.
     *
     * @param {number} [timeout=0] - Timeout in milliseconds to apply to control and data connections. Use 0 for no timeout.
     * @param {string} [encoding="utf8"] - Encoding to use for control connection. UTF-8 by default. Use "latin1" for older servers.
     */
    constructor(timeout = 0, encoding = "utf8") {
        /**
         * Timeout applied to all connections.
         * @private
         * @type {number}
         */
        this._timeout = timeout;
        /**
         * Current task to be resolved or rejected.
         * @private
         * @type {(Task | undefined)}
         */
        this._task = undefined;
        /**
         * Function that handles incoming messages and resolves or rejects a task.
         * @private
         * @type {(ResponseHandler | undefined)}
         */
        this._handler = undefined;
        /**
         * A multiline response might be received as multiple chunks.
         * @private
         * @type {string}
         */
        this._partialResponse = "";
        /**
         * The encoding used when reading from and writing to the control socket.
         * @type {string}
         */
        this._encoding = encoding;
        /**
         * Options for TLS connections.
         * @type {import("tls").ConnectionOptions}
         */
        this.tlsOptions = {};
        /**
         * IP version to prefer (4: IPv4, 6: IPv6).
         * @type {(string | undefined)}
         */
        this.ipFamily = undefined;
        /**
         * Log every communication detail.
         * @type {boolean}
         */
        this.verbose = false;
        /**
         * The control connection to the FTP server.
         * @type {Socket}
         */
        this.socket = new Socket();
        /**
         * The current data connection to the FTP server.
         * @type {(Socket | undefined)}
         */
        this.dataSocket = undefined;
    }

    /**
     * Close the context by resetting its state.
     */
    close() {
        this._passToHandler(new Error("User closed client during task."));
        this._reset();
    }

    /** @type {Socket} */
    get socket() {
        return this._socket;
    }

    /**
     * Set the socket for the control connection. This will only close the current control socket
     * if the new one is set to `undefined` because you're most likely to be upgrading an existing
     * control connection that continues to be used.
     *
     * @type {Socket}
     */
    set socket(socket) {
        // No data socket should be open in any case where the control socket is set or upgraded.
        this.dataSocket = undefined;
        if (this._socket) {
            this._removeSocketListeners(this._socket);
        }
        if (socket) {
            // Don't set a timeout yet. Timeout for control sockets is only active during a task, see handle() below.
            socket.setTimeout(0);
            socket.setEncoding(this._encoding);
            socket.setKeepAlive(true);
            // @ts-ignore that data is of type string here, not data.
            socket.on("data", data => this._onControlSocketData(data));
            this._setupErrorHandlers(socket, "control");
        }
        else {
            this._closeSocket(this._socket);
        }
        this._socket = socket;
    }

    /** @type {(Socket | undefined)} */
    get dataSocket() {
        return this._dataSocket;
    }

    /**
     * Set the socket for the data connection. This will automatically close the former data socket.
     *
     * @type {(Socket | undefined)}
     **/
    set dataSocket(socket) {
        this._closeSocket(this._dataSocket);
        if (socket) {
            socket.setTimeout(this._timeout);
            this._setupErrorHandlers(socket, "data");
        }
        this._dataSocket = socket;
    }

    /** @type {string} */
    get encoding() {
        return this._encoding;
    }

    /**
     * Set the encoding used for the control socket.
     *
     * @type {string} The encoding to use.
     */
    set encoding(encoding) {
        this._encoding = encoding;
        if (this.socket) {
            this.socket.setEncoding(encoding);
        }
    }

    /**
     * Send an FTP command without waiting for or handling the result.
     *
     * @param {string} command
     */
    send(command) {
        // Don't log passwords.
        const message = command.startsWith("PASS") ? "> PASS ###" : `> ${command}`;
        this.log(message);
        this._socket.write(command + "\r\n", this.encoding);
    }

    /**
     * Log message if set to be verbose.
     *
     * @param {string} message
     */
    log(message) {
        if (this.verbose) {
            console.log(message);
        }
    }

    /**
     * Enable timeout on the control socket connection. Disabling it can be useful if
     * a timeout should be caught by the current data connection instead of the
     * control connection that sits idle during transfers anyway.
     *
     * @param {boolean} enabled
     */
    enableControlTimeout(enabled) {
        this.socket.setTimeout(enabled ? this._timeout : 0);
    }

    /**
     * Return true if the control socket is using TLS. This does not mean that a session
     * has already been negotiated.
     *
     * @returns {boolean}
     */
    get hasTLS() {
        //@ts-ignore that not every socket has property encrypted.
        return this._socket && this._socket.encrypted === true;
    }

    /**
     * Send an FTP command and handle any response until the new task is resolved. This returns a Promise that
     * will hold whatever the handler passed on when resolving/rejecting its task.
     *
     * @param {string} command
     * @param {ResponseHandler} handler
     * @returns {Promise<any>}
     */
    handle(command, handler) {
        if (this._handler !== undefined) {
            this._closeWithError(new Error("There is still a task running. Did you forget to use '.then()' or 'await'?"));
        }
        // Only track control socket timeout during the lifecycle of a task associated with a handler.
        // That way we avoid timeouts on idle sockets, a behaviour that is not expected by most users.
        this.enableControlTimeout(true);
        return new Promise((resolvePromise, rejectPromise) => {
            this._handler = handler;
            this._task = {
                // When resolving or rejecting we also want the handler
                // to no longer receive any responses or errors.
                resolve: (...args) => {
                    this._stopTrackingTask();
                    resolvePromise(...args);
                },
                reject: err => {
                    this._stopTrackingTask();
                    rejectPromise(err);
                }
            };
            if (command !== undefined) {
                this.send(command);
            }
        });
    }

    /**
     * Removes reference to current task and handler. This won't resolve or reject the task.
     */
    _stopTrackingTask() {
        // Disable timeout on control socket if there is no task active.
        this.enableControlTimeout(false);
        this._task = undefined;
        this._handler = undefined;
    }

    /**
     * Handle incoming data on the control socket. The chunk is going to be of type `string`
     * because we let `socket` handle encoding with `setEncoding`.
     *
     * @private
     * @param {String} chunk
     */
    _onControlSocketData(chunk) {
        const trimmedChunk = chunk.trim();
        this.log(`< ${trimmedChunk}`);
        // This chunk might complete an earlier partial response.
        const response = this._partialResponse + trimmedChunk;
        const parsed = parseControlResponse(response);
        // Remember any incomplete remainder.
        this._partialResponse = parsed.rest;
        // Each response group is passed along individually.
        for (const message of parsed.messages) {
            const code = parseInt(message.substr(0, 3), 10);
            const response = { code, message };
            const err = code >= 400 ? new FTPError(response) : undefined;
            this._passToHandler(err, response);
        }
    }

    /**
     * Send the current handler a response. This is usually a control socket response
     * or a socket event, like an error or timeout.
     *
     * @private
     * @param {(Error | undefined)} err
     * @param {(FTPResponse | undefined)} [response]
     */
    _passToHandler(err, response) {
        if (this._handler) {
            this._handler(err, response, this._task);
        }
    }

    /**
     * Reset the state of this context.
     *
     * @private
     */
    _reset() {
        this.log("Closing connections.");
        this._stopTrackingTask();
        this._partialResponse = "";
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
        // Set a new socket instance to make reconnecting possible.
        this.socket = new Socket();
    }

    /**
     * Send an error to the current handler and close all connections.
     *
     * @private
     * @param {Error} err
     */
    _closeWithError(err) {
        this._passToHandler(err);
        this._reset();
    }

    /**
     * Close a socket.
     *
     * @private
     * @param {(Socket | undefined)} socket
     */
    _closeSocket(socket) {
        if (socket) {
            socket.destroy();
            this._removeSocketListeners(socket);
        }
    }

    /**
     * Setup all error handlers for a socket.
     *
     * @private
     * @param {Socket} socket
     * @param {string} identifier
     *
     *
     */
    _setupErrorHandlers(socket, identifier) {
        socket.once("error", error => {
            error.message += ` (${identifier})`;
            this._closeWithError(error);
        });
        socket.once("close", hadError => {
            if (hadError) {
                this._closeWithError(new Error(`Socket closed due to transmission error (${identifier})`));
            }
        });
        socket.once("timeout", () => this._closeWithError(new Error(`Socket timeout (${identifier})`)));
    }

    /**
     * Remove all default listeners for socket.
     *
     * @private
     * @param {Socket} socket
     */
    _removeSocketListeners(socket) {
        socket.removeAllListeners();
        // socket.removeAllListeners() without name might not work: https://github.com/nodejs/node/issues/20923
        socket.removeAllListeners("timeout");
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        socket.removeAllListeners("connect");
    }
};
