"use strict";

const Socket = require("net").Socket;
const parseControlResponse = require("./parseControlResponse");

/**
 * @typedef {Object} Task
 * @property {(...args: any[]) => void} resolve - Resolves the task.
 * @property {(...args: any[]) => void} reject - Rejects the task.
 */

/**
 * @typedef {(response: Object, task: Task) => void} ResponseHandler
 */

/**
 * FTPContext holds the control and data sockets of an FTP connection and provides a
 * simplified way to interact with an FTP server, handle responses, errors and timeouts.
 * 
 * It doesn't implement or use any FTP commands. It's only a foundation to make writing an FTP
 * client as easy as possible. You won't usually instantiate this, but use `Client`.
 */
module.exports = class FTPContext {  
    
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
        this.encoding = encoding;
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
     * Close control and data connections.
     */
    close() {
        this.log("Closing connections.");
        this._handler = undefined;
        this._task = undefined;
        this._partialResponse = "";
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
        // Set a new socket instance to make reconnecting possible.
        this.socket = new Socket();
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
            socket.setKeepAlive(true);
            socket.setTimeout(this._timeout);
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
            this.close();
            throw new Error("There is still a task running. Did you forget to use '.then()' or 'await'?");
        }
        return new Promise((resolvePromise, rejectPromise) => {
            this._handler = handler;
            this._task = {
                // When resolving or rejecting we also want the handler
                // to no longer receive any responses or errors.
                resolve: (...args) => {
                    this._handler = undefined;
                    resolvePromise(...args);
                },
                reject: (...args) => {
                    this._handler = undefined;
                    rejectPromise(...args);
                }
            };
            if (command !== undefined) {
                this.send(command);
            }
        });
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
     * Suspend timeout on the control socket connection. This can be useful if
     * a timeout should be caught by the current data connection instead of the 
     * control connection that sits idle during transfers anyway.
     * 
     * @param {boolean} suspended 
     */
    suspendControlTimeout(suspended) {
        this.socket.setTimeout(suspended ? 0 : this._timeout);
    }

    /**
     * Handle incoming data on the control socket.
     * 
     * @private
     * @param {Buffer} data 
     */
    _onControlSocketData(data) {
        let response = data.toString(this.encoding).trim();
        this.log(`< ${response}`);
        // This response might complete an earlier partial response.
        response = this._partialResponse + response;
        const parsed = parseControlResponse(response);
        // Remember any incomplete remainder.
        this._partialResponse = parsed.rest;
        // Each response group is passed along individually.
        for (const message of parsed.messages) {
            const code = parseInt(message.substr(0, 3), 10);
            this._passToHandler({ code, message });                
        }
    }

    /**
     * Send the current handler a response. This is usually a control socket response
     * or a socket event, like an error or timeout.
     * 
     * @private
     * @param {Object} response 
     */
    _passToHandler(response) {
        if (this._handler) {
            this._handler(response, this._task);
        }        
    }

    /**
     * Send an error to the current handler and close all connections.
     * 
     * @private
     * @param {*} error 
     */
    _closeWithError(error) {
        this._passToHandler({ error });
        this.close();
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
     */
    _setupErrorHandlers(socket, identifier) {
        socket.once("error", error => this._closeWithError({ ...error, ftpSocket: identifier }));
        socket.once("timeout", () => this._closeWithError({ info: "socket timeout", ftpSocket: identifier }));
        socket.once("close", hadError => {
            if (hadError) {
                this._closeWithError({ info: "socket closed due to transmission error", ftpSocket: identifier});
            }
        });
    }

    /**
     * Remove all default listeners for socket.
     * 
     * @private
     * @param {Socket} socket 
     */
    _removeSocketListeners(socket) {
        // socket.removeAllListeners() without name doesn't work: https://github.com/nodejs/node/issues/20923
        socket.removeAllListeners("timeout");
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
    }
};
