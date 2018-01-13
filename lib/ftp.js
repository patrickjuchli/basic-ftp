"use strict";

const Socket = require("net").Socket;
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const promisify = require("util").promisify;
const parseListUnix = require("./parseListUnix");
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
        // A timeout can be applied to the control connection.
        this._timeout = timeout;
        // The current task to be resolved or rejected.
        this._task = undefined;
        // A function that handles incoming messages and resolves or rejects a task.
        this._handler = undefined;
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
     * Closes control and data sockets.
     */
    close() {
        this.log("Closing sockets.");
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
    }

    get socket() {
        return this._socket;
    }

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

    get dataSocket() {
        return this._dataSocket;
    }

    set dataSocket(socket) {
        this._closeSocket(this._dataSocket);
        this._dataSocket = this._setupSocket(socket);
    }

    /**
     * Returns true if TLS is enabled for the control socket.
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
     * Logs message if client is verbose
     * @param {string} message 
     */
    log(message) {
        if (this.verbose) {
            console.log(message);
        }
    }

    /**
     * Handle incoming data on the control socket.
     * @param {Buffer} data 
     */
    _onControlSocketData(data) {
        const response = data.toString(this._encoding).trim();
        this.log(`< ${response}`);
        // This might be a multiline response. Convert into standalone
        // response groups and pass them along individually.
        parseMultilineResponse(response).forEach(message => {
            const code = parseInt(message.substr(0, 3), 10);
            this._respond({ code, message });    
        });
    }

    /**
     * Send the current handler a payload. This is usually a control socket response
     * or a socket event, like an error or timeout.
     * @param {Object} payload 
     */
    _respond(payload) {
        if (this._handler) {
            this._handler(payload, this._task);
        }        
    }

    _setupSocket(socket) {
        if (socket) {
            // All sockets share the same timeout.
            socket.setTimeout(this._timeout);
            // Reroute any events to the single communication channel with the currently responsible handler. 
            // In case of an error, the following will happen:
            // 1. The current handler should handle the error by at least rejecting the associated task.
            // 2. This rejection will then reject the Promise associated with the task.
            // 3. This rejected promise will then lead to an exception in the user's application code.
            socket.once("error", error => this._respond({ error })); // An error will automatically close a socket.
            // Report timeouts as errors.
            socket.once("timeout", () => {
                socket.destroy(); // A timeout does not automatically close a socket.
                this._respond({ error: "Timeout" });
            });
        }
        return socket;
    }

    _closeSocket(socket) {
        if (socket) {
            socket.destroy();
        }
    }
}

/**
 * A basic FTP client API.
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
        this.parseList = parseListUnix; 
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
     * @param {number} port
     * @return {Promise<PositiveResponse>}
     */
    connect(host, port) {
        this.ftp.socket.connect(port, host);
        return this.ftp.handle(undefined, (res, task) => {
            if (res.code === 220) {
                task.resolve(res);
            }
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
     * @param {string} [command="AUTH TLS"] Set the auth command, e.g. "AUTH SSL".
     * @return {Promise<PositiveResponse>}
     */
    useTLS(options, command = "AUTH TLS") {
        return this.ftp.handle(command, (res, task) => {
            if (res.code === 200 || res.code === 234) {
                upgradeSocket(this.ftp.socket, options).then(tlsSocket => {
                    this.ftp.log("Control socket is using " + tlsSocket.getProtocol());
                    this.ftp.socket = tlsSocket; // TLS socket is the control socket from now on
                    this.ftp.tlsOptions = options; // Keep the TLS options for later data connections that should use the same options.
                    task.resolve(res);
                }).catch(err => task.reject(err));
            }
            else {
                task.reject(res);
            }  
        });
    }

    /**
     * Login a user with a password.
     * 
     * @param {string} user 
     * @param {string} password 
     * @returns {Promise<PositiveResponse>}
     */
    login(user, password) {
        return this.ftp.handle("USER " + user, (res, task) => {
            if (res.code === 230 || res.code === 202) { // User logged in proceed OR Command superfluous
                task.resolve(res);
            }
            else if (res.code === 331) { // User name okay, need password
                this.ftp.send("PASS " + password);
            }
            else {
                task.reject(res);
            }
        });
    }

    /**
     * Set some default settings.
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

module.exports = {
    Client,
    FTPContext,
    FileInfo,
    // Useful for custom extensions and unit tests.
    utils: {
        upgradeSocket,
        parseListUnix,
        enterPassiveModeIPv4,
        parseMultilineResponse 
    }
};

/**
 * Upgrade a socket connection.
 * 
 * @param {Socket} socket 
 * @param {Object} options Same options as in `tls.connect(options)`
 * @returns {Promise<TLSSocket>}
 */
function upgradeSocket(socket, options) {
    return new Promise((resolve, reject) => {
        options = Object.assign({}, options, { 
            socket // Establish the secure connection using the existing socket connection.
        }); 
        const tlsSocket = tls.connect(options, () => {
            const expectCertificate = options.rejectUnauthorized !== false;
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
        if (res.code === 227) {
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
 * @return {FileInfo[]>}
 */
function list(ftp, parseList = parseListUnix) {
    // Some FTP servers transmit the list data and then confirm on the
    // control socket that the transfer is complete, others do it the
    // other way around. We'll need to make sure that we wait until
    // both the data and the confirmation have arrived.
    let ctrlDone = false;
    let rawList = "";
    let parsedList = undefined;
    return ftp.handle("LIST", (res, task) => {
        if (res.code === 150) { // Ready to download
            ftp.dataSocket.on("data", data => {
                rawList += data.toString();
            });
            ftp.dataSocket.once("end", () => {
                ftp.dataSocket = undefined;
                ftp.log(rawList);
                parsedList = parseList(rawList);
                if (ctrlDone) {
                    task.resolve(parsedList);
                }
            });
        }
        else if (res.code === 226) { // Transfer complete
            ctrlDone = true;
            if (parsedList) {
                task.resolve(parsedList);
            }
        }
        else if (res.code >= 400 || res.error) {
            ftp.dataSocket = undefined;
            task.reject(res);
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
    const command = "STOR " + remoteFilename;
    return ftp.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to upload
            // If all data has been flushed, close the socket to signal
            // the FTP server that the transfer is complete.
            ftp.dataSocket.once("finish", () => ftp.dataSocket = undefined);
            readableStream.pipe(ftp.dataSocket);
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve(res);
        }
        else if (res.code >= 400 || res.error) {
            ftp.dataSocket = undefined;
            task.reject(res);
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
    const command = startAt > 0 ? `REST ${startAt}` : `RETR ${remoteFilename}`;
    return ftp.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to download
            ftp.dataSocket.pipe(writableStream);
        }
        else if (res.code === 350) { // Restarting at startAt.
            ftp.send("RETR " + remoteFilename);
        }
        else if (res.code === 226) { // Transfer complete
            ftp.dataSocket = undefined;
            task.resolve(res);
        }
        else if (res.code >= 400 || res.error) {
            ftp.dataSocket = undefined;
            task.reject(res);
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
 * Parse an FTP response, handles single lines as well as multilines.
 * This will also convert all CRLF into LF.
 * 
 * @param {string} text 
 * @returns {string[]} 
 */
function parseMultilineResponse(text) {
    const lines = text.split(/\r?\n/);
    const groups = [];
    // Assume the first line to be the beginning of a group.
    let startAt = 0;
    let token = lines[0].substr(0, 3) + " ";
    for (let i = 0; i < lines.length; i++) {
        // Look for an opening if no group is open.
        if (token === "" && lines[i].charAt(3) === "-") {
            token = lines[i].substr(0, 3) + " ";
            startAt = i;
        }
        // Look for a closing token if a group has been opened.
        else if (token !== "" && lines[i].startsWith(token)) {
            token = "";
            groups.push(lines.slice(startAt, i + 1).join("\n"));
        }
    }
    // The last (or single) group might not have been closed.
    if (token !== "") {
        groups.push(lines.slice(startAt).join("\n"));
    }
    return groups;      
}