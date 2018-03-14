"use strict";

const Socket = require("net").Socket;
const parseControlResponse = require("./parseControlResponse");

/**
 * FTPContext holds the state of an FTP client – its control and data connections – and provides a
 * simplified way to interact with an FTP server, handle responses, errors and timeouts.
 * 
 * It doesn't implement or use any FTP commands. It's only a foundation to make writing an FTP
 * client as easy as possible. You won't usually instantiate this, but use `Client` below.
 */
module.exports = class FTPContext {  
    
    /**
     * Instantiate an FTP context.
     * 
     * @param {number} [timeout=0]  Timeout in milliseconds to apply to control and data connections. Use 0 for no timeout.
     * @param {string} [encoding="utf8"]  Encoding to use for control connection. UTF-8 by default. Use "latin1" for older servers. 
     */
    constructor(timeout = 0, encoding = "utf8") {
        // Timeout applied to all connections.
        this._timeout = timeout;
        // Current task to be resolved or rejected.
        this._task = undefined;
        // Function that handles incoming messages and resolves or rejects a task.
        this._handler = undefined;
        // A multiline response might be received as multiple chunks.
        this._partialResponse = "";
        // The encoding used when reading from and writing on the control socket.
        this.encoding = encoding;
        // Options for TLS connections.
        this.tlsOptions = {};
        // The client can log every outgoing and incoming message.
        this.verbose = false;
        // The control connection to the FTP server.
        this.socket = new Socket();
        // The data connection to the FTP server.
        this.dataSocket = undefined;
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
     * Set the socket for the control connection. This will *not* close the former control socket automatically.
     * 
     * @type {Socket}
     */
    set socket(socket) {
        if (this._socket) {
            // Don't close the existing control socket automatically.
            // The setter might have been called to upgrade an existing connection.
            this._socket.removeAllListeners();
        }
        this._socket = this._setupSocket(socket);
        if (this._socket) {
            this._socket.setKeepAlive(true);
            this._socket.on("data", data => this._onControlSocketData(data));
        }
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
        this._dataSocket = this._setupSocket(socket);
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
        this._socket.write(command + "\r\n", this._encoding);
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
     * Handle incoming data on the control socket.
     * 
     * @private
     * @param {Buffer} data 
     */
    _onControlSocketData(data) {
        let response = data.toString(this._encoding).trim();
        this.log(`< ${response}`);
        // This response might complete an earlier partial response.
        response = this._partialResponse + response;
        const parsed = parseControlResponse(response);
        // Remember any incomplete remainder.
        this._partialResponse = parsed.rest;
        // Each response group is passed along individually.
        for (const message of parsed.messages) {
            const code = parseInt(message.substr(0, 3), 10);
            this._respond({ code, message });                
        }
    }

    /**
     * Send the current handler a payload. This is usually a control socket response
     * or a socket event, like an error or timeout.
     * 
     * @private
     * @param {Object} payload 
     */
    _respond(payload) {
        if (this._handler) {
            this._handler(payload, this._task);
        }        
    }

    /**
     * Configure socket properties common to both control and data socket connections.
     * 
     * @private
     * @param {Socket} socket 
     */
    _setupSocket(socket) {
        if (socket) {
            // All sockets share the same timeout.
            socket.setTimeout(this._timeout);
            // Reroute any events to the single communication channel with the currently responsible handler. 
            // In case of an error, the following will happen:
            // 1. The current handler will receive a response with the error description.
            // 2. The handler should then handle the error by at least rejecting the associated task.
            // 3. This rejection will then reject the Promise associated with the task.
            // 4. This rejected promise will then lead to an exception in the user's application code.
            socket.once("error", error => this._respond({ error })); // An error will automatically close a socket.
            // Report timeouts as errors.
            socket.once("timeout", () => {
                socket.destroy(); // A timeout does not automatically close a socket.
                this._respond({ error: "Timeout" });
            });
        }
        return socket;
    }

    /**
     * Close a socket.
     * 
     * @private
     * @param {Socket} socket 
     */
    _closeSocket(socket) {
        if (socket) {
            socket.removeAllListeners();
            socket.destroy();
        }
    }
}
