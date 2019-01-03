"use strict";

const Socket = require("net").Socket;
const parseControlResponse = require("./parseControlResponse");

/**
 * @typedef {Object} Task
 * @property {ResponseHandler} responseHandler - Handles a response for a task.
 * @property {TaskResolver} resolver - Resolves or rejects a task.
 * @property {string} stack - Call stack when task is run.
 */

/**
 * @typedef {(err: Error | undefined, response: FTPResponse | undefined, task: TaskResolver) => void} ResponseHandler
 */

/**
 * @typedef {Object} TaskResolver
 * @property {(...args: any[]) => void} resolve - Resolves the task.
 * @property {(err: Error) => void} reject - Rejects the task.
 */

/**
 * @typedef {Object} FTPResponse
 * @property {number} code - FTP response code
 * @property {string} message - FTP response including code
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
        this.name = this.constructor.name;
        this.code = res.code;
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
         * A multiline response might be received as multiple chunks.
         * @private
         * @type {string}
         */
        this._partialResponse = "";
        /**
         * TODO describe
         * @private
         * @type {(Error | undefined)}
         */
        this._closingError = undefined;
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
     * Close the context.
     *
     * The context can’t be used anymore after calling this method.
     */
    close() {
        // If this context already has been closed, don't overwrite the reason.
        if (this._closingError) {
            return;
        }
        // Close with an error: If there is an active task it will receive it justifiably because the user
        // closed while a task was still running. If no task is running, no error will be thrown (see _closeWithError)
        // but all newly submitted tasks after that will be rejected because "the client is closed". Plus, the user
        // gets a stack trace in case it's not clear where exactly the client was closed. We use _closingError to
        // determine whether a context is closed. This also allows us to have a single code-path for closing a context.
        const message = this._task ? "User closed client during task" : "User closed client";
        const err = new Error(message);
        this._closeWithError(err);
    }

    /**
     * @returns {boolean}
     */
    get closed() {
        return this._closingError !== undefined;
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
            this._setupErrorHandlers(socket, "control socket");
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
            this._setupErrorHandlers(socket, "data socket");
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
     * @param {ResponseHandler} responseHandler
     * @returns {Promise<any>}
     */
    handle(command, responseHandler) {
        if (this._task) {
            // The user or client instance called `handle()` while a task is still running.
            const err = new Error("User launched a task while another one is still running. Forgot to use 'await' or '.then()'?");
            err.stack += `\nRunning task launched at: ${this._task.stack}`;
            this._closeWithError(err);
        }
        return new Promise((resolvePromise, rejectPromise) => {
            const resolver = {
                resolve: (...args) => {
                    this._stopTrackingTask();
                    resolvePromise(...args);
                },
                reject: err => {
                    this._stopTrackingTask();
                    rejectPromise(err);
                }
            };
            this._task = {
                stack: new Error().stack,
                resolver,
                responseHandler
            };
            if (this._closingError) {
                // This client has been closed. Provide an error that describes this one as being caused
                // by `_closingError`, include stack traces for both.
                const err = new Error("Client is closed");
                err.stack += `\nClosing reason: ${this._closingError.stack}`;
                // @ts-ignore that `Error` doesn't have `code` by default.
                err.code = this._closingError.code !== undefined ? this._closingError.code : 0;
                this._passToHandler(err);
            }
            else if (command) {
                // Only track control socket timeout during the lifecycle of a task. This avoids timeouts on idle sockets,
                // the default socket behaviour which is not expected by most users.
                this.enableControlTimeout(true);
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
        if (this._task) {
            this._task.responseHandler(err, response, this._task.resolver);
        }
        // Errors other than FTPError always close the client. If there isn't an active task to handle the error,
        // the next one submitted will receive it using `_closingError`.
        // There is only one edge-case: If there is an FTPError while no task is active, the error will be dropped.
        // But that means that the user sent an FTP command with no intention of handling the result. So why should the
        // error be handled? Maybe log it at least? Debug logging will already do that and the client stays useable after
        // FTPError. So maybe no need to do anything here.
    }

    /**
     * Send an error to the current handler and close all connections.
     *
     * @private
     * @param {Error} err
     */
    _closeWithError(err) {
        this._closingError = err;
        // Before giving the user's task a chance to react, make sure we won't be bothered with any inputs.
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
        // Give the user's task a chance to react, maybe cleanup resources.
        this._passToHandler(err);
        // The task might not have been rejected by the user after receiving the error.
        this._stopTrackingTask();
    }

    /**
     * Setup all error handlers for a socket.
     *
     * @private
     * @param {Socket} socket
     * @param {string} identifier
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
        socket.once("timeout", () => this._closeWithError(new Error(`Timeout (${identifier})`)));
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
     * Remove all default listeners for socket.
     *
     * @private
     * @param {Socket} socket
     */
    _removeSocketListeners(socket) {
        socket.removeAllListeners();
        // Before Node.js 10.3.0, using `socket.removeAllListeners()` without any name did not work: https://github.com/nodejs/node/issues/20923.
        socket.removeAllListeners("timeout");
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        socket.removeAllListeners("connect");
    }
};
