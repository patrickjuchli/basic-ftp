"use strict";

const Socket = require("net").Socket;
const parseControlResponse = require("./parseControlResponse");

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
     * @param {number} [timeout=0]  Timeout in milliseconds to apply to control and data connections. Use 0 for no timeout.
     * @param {string} [encoding="utf8"]  Encoding to use for control connection. UTF-8 by default. Use "latin1" for older servers. 
     */
    constructor(timeout = 0, encoding = "utf8") {
        this._timeout = timeout; // Timeout applied to all connections.
        this._task = undefined; // Current task to be resolved or rejected.
        this._handler = undefined; // Function that handles incoming messages and resolves or rejects a task.  
        this._partialResponse = ""; // A multiline response might be received as multiple chunks.
        this.encoding = encoding; // The encoding used when reading from and writing on the control socket.
        this.tlsOptions = {}; // Options for TLS connections.
        this.ipFamily = undefined; // IP version to prefer (4: IPv4, 6: IPv6).
        this.verbose = false; // The client can log every outgoing and incoming message.
        this.socket = new Socket(); // The control connection to the FTP server.
        this.dataSocket = undefined; // The data connection to the FTP server.
    }

    /**
     * Close control and data connections.
     */
    close() {
        this.log("Closing sockets.");
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
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
            // socket.removeAllListeners() without name doesn't work: https://github.com/nodejs/node/issues/20923
            this._socket.removeAllListeners("timeout");
            this._socket.removeAllListeners("data");
            this._socket.removeAllListeners("error");
        }
        if (socket) {
            socket.setKeepAlive(true);
            socket.setTimeout(this._timeout);
            socket.on("data", data => this._onControlSocketData(data));
            socket.once("error", error => this._closeWithError(error));
            socket.once("timeout", () => this._closeWithError("Timeout control connection"));
        }
        else {
            this._closeSocket(this._socket);
        }
        this._socket = socket;
    }

    /** @type {Socket} */
    get dataSocket() {
        return this._dataSocket;
    }

    /**
     * Set the socket for the data connection. This will automatically close the former data socket.
     * 
     * @type {Socket} 
     **/
    set dataSocket(socket) {
        this._closeSocket(this._dataSocket);
        if (socket) {
            socket.setTimeout(this._timeout);
            socket.once("error", error => this._closeWithError(error));
            socket.once("timeout", () => this._closeWithError("Timeout data connection"));
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
        return this._socket && this._socket.encrypted === true;
    }

    /**
     * Send an FTP command and handle any response until the new task is resolved. This returns a Promise that
     * will hold whatever the handler passed on when resolving/rejecting its task.
     * 
     * @param {string} command
     * @param {HandlerCallback} handler
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
     * Send the current handler a payload. This is usually a control socket response
     * or a socket event, like an error or timeout.
     * 
     * @private
     * @param {Object} payload 
     */
    _passToHandler(payload) {
        if (this._handler) {
            this._handler(payload, this._task);
        }        
    }

    /**
     * Send an error to the current handler and close all connections.
     * 
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
     * @param {Socket} socket 
     */
    _closeSocket(socket) {
        if (socket) {
            socket.destroy();
            // socket.removeAllListeners() without name doesn't work: https://github.com/nodejs/node/issues/20923
            socket.removeAllListeners("timeout");
            socket.removeAllListeners("data");
            socket.removeAllListeners("error");
        }
    }
};
