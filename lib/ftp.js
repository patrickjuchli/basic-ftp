"use strict";

const Socket = require("net").Socket;
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const promisify = require("util").promisify;
const defaultParseList = require("./parseList");
const FileInfo = require("./FileInfo");

const fsReadDir = promisify(fs.readdir);
const fsMkDir = promisify(fs.mkdir);
const fsStat = promisify(fs.stat);

/**
 * An FTPContext provides the foundation to write an FTP client. It holds the socket
 * connections and provides a pattern to handle responses and simplifies event handling.
 * 
 * Users don't normally instantiate this, instead use an API like `Client`.
 */
class FTPContext {  
    
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
     * Return true if TLS is enabled for the control socket.
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

/**
 * An FTP client.
 */
class Client {
    
    /**
     * Instantiate an FTP client.
     * 
     * @param {number} [timeout=0]  Timeout in milliseconds, use 0 for no timeout.
     */
    constructor(timeout = 0) {
        this.ftp = new FTPContext(timeout);
        this.prepareTransfer = enterPassiveModeIPv4;
        this.parseList = defaultParseList; 
    }

    /**
     * Close all connections. The FTP client can't be used anymore after calling this.
     */
    close() {
        this.ftp.close();
    }

    /**
     * @typedef {Object} PositiveResponse
     * @property {number} code  The FTP return code parsed from the FTP return message.
     * @property {string} message  The whole unparsed FTP return message.
     */

    /**
     * @typedef {Object} NegativeResponse
     * @property {Object|string} error  The error description.
     * 
     * Negative responses are usually thrown as exceptions, not returned as values.
     */

    /**
     * Connect to an FTP server.
     * 
     * @param {string} host
     * @param {number} [port=21]
     * @return {Promise<PositiveResponse>}
     */
    connect(host, port = 21) {
        this.ftp.socket.connect(port, host);
        return this.ftp.handle(undefined, (res, task) => {
            if (positiveCompletion(res.code)) {
                task.resolve(res);
            }
            // Reject all other codes, including 120 "Service ready in nnn minutes".
            else {
                task.reject(res);
            }
        });
    }

    /**
     * Send an FTP command. If successful it will return a response object that contains
     * the return code as well as the whole message.
     * 
     * @param {string} command
     * @param {boolean} ignoreError
     * @return {Promise<PositiveResponse>}
     */
    send(command, ignoreErrorCodes = false) {
        return this.ftp.handle(command, (res, task) => {
            const success = res.code >= 200 && res.code < 400;
            if (success || (res.code && ignoreErrorCodes)) {
                task.resolve(res);
            }
            else {
                task.reject(res);
            }
        });
    }

    /**
     * Upgrade the current socket connection to TLS.
     * 
     * @param {Object} [options] TLS options as in `tls.connect(options)`
     * @param {string} [command="AUTH TLS"] Set the authentication command, e.g. "AUTH SSL" instead of "AUTH TLS".
     * @return {Promise<PositiveResponse>}
     */
    async useTLS(options, command = "AUTH TLS") {
        const ret = await this.send(command);
        this.ftp.socket = await upgradeSocket(this.ftp.socket, options);
        this.ftp.tlsOptions = options; // Keep the TLS options for later data connections that should use the same options.
        this.ftp.log("Control socket is using " + this.ftp.socket.getProtocol());
        return ret;
    }

    /**
     * Login a user with a password.
     * 
     * @param {string} [user="anonymous"] 
     * @param {string} [password="guest"]
     * @returns {Promise<PositiveResponse>}
     */
    login(user = "anonymous", password = "guest") {
        return this.ftp.handle("USER " + user, (res, task) => {
            if (positiveCompletion(res.code)) { // User logged in proceed OR Command superfluous
                task.resolve(res);
            }
            else if (res.code === 331) { // User name okay, need password
                this.ftp.send("PASS " + password);
            }
            else { // Also report error on 332 (Need account)
                task.reject(res);
            }
        });
    }

    /**
     * Set some default settings you should be setting.
     */
    async useDefaultSettings() {
        await this.send("TYPE I"); // Binary mode
        await this.send("STRU F"); // Use file structure
        if (this.ftp.hasTLS) {
            await this.send("PBSZ 0"); // Set to 0 for TLS
            await this.send("PROT P"); // Protect channel (also for data connections)
        }
    }

    /**
     * Set the working directory.
     * 
     * @param {string} path
     * @returns {Promise<PositiveResponse>} 
     */
    cd(path) {
        return this.send("CWD " + path);
    }

    /**
     * Get the working directory.
     * 
     * @returns {Promise<string>}
     */
    async pwd() {
        const res = await this.send("PWD");
        // The directory is part of the return message, for example: 
        // 257 "/this/that" is current directory.
        return res.message.match(/"(.+)"/)[1];
    } 

    /**
     * Get a description of supported features.
     * 
     * This sends the FEAT command and parses the result into a Map where keys correspond to available commands
     * and values hold further information. Be aware that your FTP servers might not support this
     * command in which case this method will not throw an exception but just return an empty Map.
     * 
     * @returns {Map<string, string>} 
     */
    async features() {
        const res = await this.send("FEAT", true);
        const features = new Map();
        // Not supporting any special features will be reported with a single line.
        if (res.code < 400 && isMultiline(res.message)) {
            // The first and last line wrap the multiline response, ignore them.
            res.message.split("\n").slice(1, -1).forEach(line => {
                // A typical lines looks like: " REST STREAM" or " MDTM". 
                // Servers might not use an indentation though.
                const entry = line.trim().split(" ");
                features.set(entry[0], entry[1] || "");
            });
        }
        return features;
    }

    /**
     * Get the size of a file.
     * 
     * @param {string} filename 
     * @returns {Promise<number>}
     */
    async size(filename) {
        const res = await this.send("SIZE " + filename);
        // The size is part of the response message, for example: "213 555555"
        const size = res.message.match(/^\d\d\d (\d+)/)[1];
        return parseInt(size, 10);
    }

    /**
     * Upload data from a readable stream and store it as a file with
     * a given filename in the current working directory. 
     * 
     * @param {stream.Readable} readableStream 
     * @param {string} remoteFilename 
     */
    async upload(readableStream, remoteFilename) {
        await this.prepareTransfer(this.ftp);
        return upload(this.ftp, readableStream, remoteFilename);
    }

    /**
     * Download a file with a given filename from the current working directory 
     * and pipe its data to a writable stream. You may optionally start at a specific 
     * offset, for example to resume a cancelled transfer.
     * 
     * @param {stream.Writable} writableStream 
     * @param {string} remoteFilename 
     * @param {number} [startAt=0]
     */
    async download(writableStream, remoteFilename, startAt = 0) {
        await this.prepareTransfer(this.ftp);
        return download(this.ftp, writableStream, remoteFilename, startAt);
    }

    /**
     * List files and directories in the current working directory.
     * 
     * @returns {FileInfo[]}
     */
    async list() {
        await this.prepareTransfer(this.ftp);
        return list(this.ftp, this.parseList);
    }

    /**
     * Remove a directory and all of its content.
     * 
     * @param {string} remoteDirPath
     * @returns {Promise<void>}
     */
    async removeDir(remoteDirPath) {
        await this.cd(remoteDirPath);
        await this.clearWorkingDir();
        // Remove the directory itself if we're not already on root.
        const workingDir = await this.pwd();
        if (workingDir !== "/") {
            await this.send("CDUP");
            await this.send("RMD " + remoteDirPath);        
        }
    }

    /**
     * Remove all files and directories in the working directory without removing
     * the working directory itself.
     * 
     * @returns {Promise<void>}
     */
    async clearWorkingDir() {
        for (const file of await this.list()) {
            if (file.isDirectory) {
                await this.cd(file.name);
                await this.clearWorkingDir();
                await this.send("CDUP");
                await this.send("RMD " + file.name);
            }
            else {
                await this.send("DELE " + file.name);
            }
        }
    }

    /**
     * Upload the contents of a local directory to the working directory. You can 
     * optionally provide a `remoteDirName` to put the contents inside a newly created directory.
     * 
     * @param {string} localDirPath  A local path, e.g. "foo/bar" or "../test"
     * @param {string} [remoteDirName]  The name of the remote directory. If undefined, directory contents will be uploaded to the working directory.
     */
    async uploadDir(localDirPath, remoteDirName = undefined) {
        // If a remote directory name has been provided, create it and cd into it.
        if (remoteDirName !== undefined) {
            if (remoteDirName.indexOf("/") !== -1) {
                throw new Error(`Path provided '${remoteDirName}' instead of single directory name.`);
            }
            await this.send("MKD " + remoteDirName);
            await this.cd(remoteDirName);
        }
        await this.uploadDirContents(localDirPath);
        // The working directory should stay the same after this operation.
        if (remoteDirName !== undefined) {
            await this.send("CDUP");
        }
    }

    /**
     * Upload the contents of a local directory to the working directory.
     * 
     * @param {string} localDirPath 
     */
    async uploadDirContents(localDirPath) {
        const files = await fsReadDir(localDirPath);
        for (const file of files) {
            const fullPath = path.join(localDirPath, file);
            const stats = await fsStat(fullPath);
            if (stats.isFile()) {
                await this.upload(fs.createReadStream(fullPath), file);
            }
            else if (stats.isDirectory()) {
                await this.send("MKD " + file);
                await this.cd(file);
                await this.uploadDirContents(fullPath);
                await this.send("CDUP"); 
            }
        }
    }

    /**
     * Download all files and directories of the working directory to a local directory.
     * 
     * @param {string} localDirPath 
     */
    async downloadDir(localDirPath) {
        await ensureLocalDirectory(localDirPath);
        for (const file of await this.list()) {
            const localPath = path.join(localDirPath, file.name);
            if (file.isDirectory) {
                await this.cd(file.name);
                await this.downloadDir(localPath);
                await this.send("CDUP");
            }
            else {
                const writable = fs.createWriteStream(localPath);
                await this.download(writable, file.name);
            }
        }
    }

    /**
     * Make sure a given remote path exists, creating all directories as necessary. This
     * function also changes the current working directory to the given path.
     * 
     * @param {string} remoteDirPath 
     */
    async ensureDir(remoteDirPath) {
        const names = remoteDirPath.split("/").filter(name => name !== "");
        // If the remoteDirPath was absolute go to root directory.
        if (remoteDirPath.startsWith("/")) {
            await this.cd("/");
        }
        for (const name of names) {
            // Check first if the directory exists. Just calling MKD might
            // result in a permission error for intermediate directories.
            const res = await this.send("CWD " + name, true);
            if (res.code >= 400) {
                await this.send("MKD " + name);
                await this.cd(name);    
            }
        }
    }
}

/**
 * Resolves a given task if one party has provided a result and another
 * one confirmed it. This is used for all FTP transfers. For example when
 * downloading, the server might confirm with "226 Transfer complete" when
 * in fact the download on the data connection has not finished yet. With
 * all transfers we make sure that a) the result arrived and b) has been 
 * confirmed by e.g. the control connection. We just don't know in which
 * order this will happen.
 * 
 * This is used internally by the list, upload and download functions.
 */
class TransferResolver {
    
    constructor(ftp) {
        this.ftp = ftp;
        this.result = undefined;
        this.confirmed = false;
    }

    resolve(task, result) {
        this.result = result;
        this._tryResolve(task);
    }

    confirm(task) {
        this.confirmed = true;
        this._tryResolve(task);
    }

    reject(task, reason) {
        this.ftp.dataSocket = undefined;
        task.reject(reason);
    }

    _tryResolve(task) {
        if (this.confirmed && this.result !== undefined) {
            this.ftp.dataSocket = undefined;
            task.resolve(this.result);    
        }
    }
}

module.exports = {
    Client,
    FTPContext,
    FileInfo,
    // Useful for custom extensions and unit tests.
    utils: {
        download,
        upload,
        list,
        upgradeSocket,
        parseControlResponse,
        TransferResolver
    }
};

function positiveCompletion(code) {
    return code >= 200 && code < 300;
}

/**
 * Upgrade a socket connection.
 * 
 * @param {Socket} socket 
 * @param {Object} options Same options as in `tls.connect(options)`
 * @returns {Promise<TLSSocket>}
 */
function upgradeSocket(socket, options) {
    return new Promise((resolve, reject) => {
        const tlsOptions = Object.assign({}, options, { 
            socket // Establish the secure connection using the existing socket connection.
        }); 
        const tlsSocket = tls.connect(tlsOptions, () => {
            const expectCertificate = tlsOptions.rejectUnauthorized !== false;
            if (expectCertificate && !tlsSocket.authorized) {
                reject(tlsSocket.authorizationError);
            }
            else {
                resolve(tlsSocket);
            }
        });                
    });
}

/**
 * Prepare a data socket using passive mode.
 * 
 * @param {FTP} ftp
 * @returns {Promise<PositiveResponse>}
 */
function enterPassiveModeIPv4(ftp) {
    return ftp.handle("PASV", (res, task) => {
        if (positiveCompletion(res.code)) {
            const target = parseIPv4PasvResponse(res.message);
            if (!target) {
                task.reject("Can't parse PASV response", res.message);
                return;
            }
            let socket = new Socket();
            socket.once("error", err => {
                task.reject("Can't open data connection in passive mode: " + err.message);
            });
            socket.connect(target.port, target.host, () => {
                if (ftp.hasTLS) {
                    // Upgrade to TLS, reuse TLS session of control socket.
                    const options = Object.assign({}, ftp.tlsOptions, { 
                        socket, 
                        session: ftp.socket.getSession()
                    });
                    socket = tls.connect(options);
                    ftp.log("Data socket uses " + socket.getProtocol());
                }
                socket.removeAllListeners();
                ftp.dataSocket = socket;
                task.resolve(res);    
            });
        }
        else {
            task.reject(res);
        }
    });   
}

/**
 * Parse a PASV response message.
 * 
 * @param {string} message
 * @returns {{host: string, port: number}}
 */
function parseIPv4PasvResponse(message) {
    // From something like "227 Entering Passive Mode (192,168,3,200,10,229)",
    // extract host and port.
    const groups = message.match(/([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/);
    if (!groups || groups.length !== 4) {
        return undefined;
    }
    return {
        host: groups[1].replace(/,/g, "."),
        port: (parseInt(groups[2], 10) & 255) * 256 + (parseInt(groups[3], 10) & 255)
    };
}

/**
 * List files and folders of current directory.`
 * 
 * @param {FTP} ftp
 * @param {(rawList: string) => FileInfo[]} parseList
 * @return {Promise<FileInfo[]>}
 */
function list(ftp, parseList = defaultParseList) {
    const resolver = new TransferResolver(ftp);    
    let rawList = "";
    return ftp.handle("LIST", (res, task) => {
        if (res.code === 150 || res.code === 125) { // Ready to download
            ftp.dataSocket.on("data", data => {
                rawList += data.toString(ftp.encoding);
            });
            ftp.dataSocket.once("end", () => {
                ftp.log(rawList);
                resolver.resolve(task, parseList(rawList));
            });
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.confirm(task);
        }
        else if (res.code >= 400 || res.error) {
            resolver.reject(task, res);
        }
    }); 
}

/**
 * Upload stream data as a file. For example:
 * 
 * `upload(ftp, fs.createReadStream(localFilePath), remoteFilename)`
 * 
 * @param {FTP} ftp 
 * @param {stream.Readable} readableStream 
 * @param {string} remoteFilename 
 * @returns {Promise<PositiveResponse>}
 */
function upload(ftp, readableStream, remoteFilename) {
    const resolver = new TransferResolver(ftp);
    const command = "STOR " + remoteFilename;
    return ftp.handle(command, (res, task) => {
        if (res.code === 150 || res.code === 125) { // Ready to upload
            ftp.dataSocket.once("finish", () => {
                // If all data has been flushed, close the data socket explicitly
                // to signal the FTP server that the transfer is complete.
                ftp.dataSocket = undefined;
                resolver.confirm(task);
            });
            readableStream.pipe(ftp.dataSocket);
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.resolve(task, res.code);
        }
        else if (res.code >= 400 || res.error) {
            resolver.reject(task, res);
        }
    });
}

/**
 * Download a remote file as a stream. For example:
 * 
 * `download(ftp, fs.createWriteStream(localFilePath), remoteFilename)`
 * 
 * @param {FTP} ftp 
 * @param {stream.Writable} writableStream 
 * @param {string} remoteFilename 
 * @param {number} startAt 
 * @returns {Promise<PositiveResponse>}
 */
function download(ftp, writableStream, remoteFilename, startAt = 0) {
    const resolver = new TransferResolver(ftp);
    const command = startAt > 0 ? `REST ${startAt}` : `RETR ${remoteFilename}`;
    return ftp.handle(command, (res, task) => {
        if (res.code === 150 || res.code === 125) { // Ready to download
            ftp.dataSocket.once("end", () => resolver.confirm(task));
            ftp.dataSocket.pipe(writableStream);
        }
        else if (res.code === 350) { // Restarting at startAt.
            ftp.send("RETR " + remoteFilename);
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.resolve(task, res.code);
        }
        else if (res.code >= 400 || res.error) {
            resolver.reject(task, res);
        }
    });
}

async function ensureLocalDirectory(path) {
    try {
        await fsStat(path);
    }
    catch(err) {
        await fsMkDir(path);
    }    
}

/**
 * Parse an FTP control response as a collection of messages. A message is a complete 
 * single- or multiline response. A response can also contain multiple multiline responses 
 * that will each be represented by a message. A response can also be incomplete 
 * and be completed on the next incoming data chunk for which case this function also 
 * describes a `rest`. This function converts all CRLF to LF.
 * 
 * @param {string} text 
 * @returns {{messages: string[], rest: string}} 
 */
function parseControlResponse(text) {
    const lines = text.split(/\r?\n/);
    const messages = [];
    let startAt = 0;
    let token = "";
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // No group has been opened.
        if (token === "") {
            if (isMultiline(line)) {
                // Open a group by setting an expected token.
                token = line.substr(0, 3) + " ";
                startAt = i;                    
            }
            else if (isSingle(line)) {
                // Single lines can be grouped immediately.
                messages.push(line);
            }
        }
        // Group has been opened, expect closing token.
        else if (line.startsWith(token)) {
            token = "";
            messages.push(lines.slice(startAt, i + 1).join("\n"));
        }
    }
    // The last group might not have been closed, report it as a rest.
    const rest = token !== "" ? lines.slice(startAt).join("\n") + "\n" : "";
    return { messages, rest };      
}

function isSingle(line) {
    return /^\d\d\d /.test(line);
}

function isMultiline(line) {
    return /^\d\d\d-/.test(line);
}