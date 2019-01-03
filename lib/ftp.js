"use strict";

const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const promisify = require("util").promisify;
const parseListAutoDetect = require("./parseList");
const nullObject = require("./nullObject");
const { FTPContext, FTPError } = require("./FtpContext");
const FileInfo = require("./FileInfo");
const StringWriter = require("./StringWriter");
const ProgressTracker = require("./ProgressTracker");

const fsReadDir = promisify(fs.readdir);
const fsMkDir = promisify(fs.mkdir);
const fsStat = promisify(fs.stat);

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
 * Client offers an API to interact with an FTP server.
 */
class Client {

    /**
     * Instantiate an FTP client.
     *
     * @param {number} [timeout=30000]  Timeout in milliseconds, use 0 for no timeout.
     */
    constructor(timeout = 30000) {
        this.ftp = new FTPContext(timeout);
        this.prepareTransfer = enterFirstCompatibleMode(enterPassiveModeIPv6, enterPassiveModeIPv4);
        this.parseList = parseListAutoDetect;
        this._progressTracker = new ProgressTracker();
    }

    /**
     * Close the client and all open socket connections.
     *
     * The client can’t be used anymore after calling this method, you have to instantiate a new one to continue any work.
     */
    close() {
        this.ftp.close();
        this._progressTracker.stop();
    }

    /**
     * @returns {boolean}
     */
    get closed() {
        return this.ftp.closed;
    }

    /**
     * Connect to an FTP server.
     *
     * @param {string} [host=localhost]  Host the client should connect to.
     * @param {number} [port=21]  Port the client should connect to.
     * @returns {Promise<PositiveResponse>}
     */
    connect(host = "localhost", port = 21) {
        this.ftp.socket.connect({
            host,
            port,
            family: this.ftp.ipFamily
        }, () => this.ftp.log(`Connected to ${describeAddress(this.ftp.socket)}`));
        return this.ftp.handle(undefined, (err, res, task) => {
            if (err) {
                task.reject(err);
            }
            else if (positiveCompletion(res.code)) {
                task.resolve(res);
            }
            else {
                // Reject all other codes, including 120 "Service ready in nnn minutes".
                task.reject(new FTPError(res));
            }
        });
    }

    /**
     * Send an FTP command.
     *
     * If successful it will return a response object that contains the return code as well
     * as the whole message. Ignore FTP error codes if you don't want an exception to be thrown
     * if an FTP command didn't succeed.
     *
     * @param {string} command  FTP command to send.
     * @param {boolean} [ignoreErrorCodes=false]  Whether to ignore FTP error codes in result.
     * @returns {Promise<PositiveResponse>}
     */
    send(command, ignoreErrorCodes = false) {
        return this.ftp.handle(command, (err, res, task) => {
            if (err instanceof FTPError && ignoreErrorCodes) {
                task.resolve(res);
            }
            else if (err) {
                task.reject(err);
            }
            else {
                task.resolve(res);
            }
        });
    }

    /**
     * Upgrade the current socket connection to TLS.
     *
     * @param {tls.ConnectionOptions} [options={}]  TLS options as in `tls.connect(options)`
     * @param {string} [command="AUTH TLS"]  Set the authentication command, e.g. "AUTH SSL" instead of "AUTH TLS".
     * @returns {Promise<PositiveResponse>}
     */
    async useTLS(options = {}, command = "AUTH TLS") {
        const ret = await this.send(command);
        this.ftp.socket = await upgradeSocket(this.ftp.socket, options);
        this.ftp.tlsOptions = options; // Keep the TLS options for later data connections that should use the same options.
        this.ftp.log(`Control socket is using: ${describeTLS(this.ftp.socket)}`);
        return ret;
    }

    /**
     * Login a user with a password.
     *
     * @param {string} [user="anonymous"]  Username to use for login.
     * @param {string} [password="guest"]  Password to use for login.
     * @returns {Promise<PositiveResponse>}
     */
    login(user = "anonymous", password = "guest") {
        this.ftp.log(`Login security: ${describeTLS(this.ftp.socket)}`);
        return this.ftp.handle("USER " + user, (err, res, task) => {
            if (err) {
                task.reject(err);
            }
            else if (positiveCompletion(res.code)) { // User logged in proceed OR Command superfluous
                task.resolve(res);
            }
            else if (res.code === 331) { // User name okay, need password
                this.ftp.send("PASS " + password);
            }
            else { // Also report error on 332 (Need account)
                task.reject(new FTPError(res));
            }
        });
    }

    /**
     * Set the usual default settings.
     *
     * Settings used:
     * * Binary mode (TYPE I)
     * * File structure (STRU F)
     * * Additional settings for FTPS (PBSZ 0, PROT P)
     *
     * @returns {Promise<void>}
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
     * Convenience method that calls `connect`, `useTLS`, `login` and `useDefaultSettings`.
     *
     * @typedef {Object} AccessOptions
     * @property {string} [host]  Host the client should connect to.
     * @property {number} [port]  Port the client should connect to.
     * @property {string} [user]  Username to use for login.
     * @property {string} [password]  Password to use for login.
     * @property {boolean} [secure]  Use explicit FTPS over TLS.
     * @property {tls.ConnectionOptions} [secureOptions]  TLS options as in `tls.connect(options)`
     * @param {AccessOptions} options
     * @returns {Promise<PositiveResponse>} The response after initial connect.
     */
    async access(options = {}) {
        const welcome = await this.connect(options.host, options.port);
        if (options.secure === true) {
            await this.useTLS(options.secureOptions);
        }
        await this.login(options.user, options.password);
        await this.useDefaultSettings();
        return welcome;
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
     * Get the current working directory.
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
     * Get the last modified time of a file. Not supported by every FTP server, method might throw exception.
     *
     * @param {string} filename  Name of the file in the current working directory.
     * @returns {Promise<Date>}
     */
    async lastMod(filename) {
        const res = await this.send("MDTM " + filename);
        const msg = res.message;
        // The command will return a concatenated string of the last modified time
        // Example: 213 19991005213102
        // Example: 213 19980615100045.014
        const date = new Date();
        date.setUTCFullYear(msg.slice(4, 8), msg.slice(8, 10) - 1, msg.slice(10, 12));
        date.setUTCHours(msg.slice(12, 14), msg.slice(14, 16), msg.slice(16, 18), msg.slice(19, 22));
        return date;
    }

    /**
     * Get a description of supported features.
     *
     * This sends the FEAT command and parses the result into a Map where keys correspond to available commands
     * and values hold further information. Be aware that your FTP servers might not support this
     * command in which case this method will not throw an exception but just return an empty Map.
     *
     * @returns {Promise<Map<string, string>>} a Map, keys hold commands and values further options.
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
     * @param {string} filename  Name of the file in the current working directory.
     * @returns {Promise<number>}
     */
    async size(filename) {
        const res = await this.send("SIZE " + filename);
        // The size is part of the response message, for example: "213 555555"
        const size = res.message.match(/^\d\d\d (\d+)/)[1];
        return parseInt(size, 10);
    }

    /**
     * Rename a file.
     *
     * Depending on the FTP server this might also be used to move a file from one
     * directory to another by providing full paths.
     *
     * @param {string} path
     * @param {string} newPath
     * @returns {Promise<PositiveResponse>} response of second command (RNTO)
     */
    async rename(path, newPath) {
        await this.send("RNFR " + path);
        return await this.send("RNTO " + newPath);
    }

    /**
     * Remove a file from the current working directory.
     *
     * You can ignore FTP error return codes which won't throw an exception if e.g.
     * the file doesn't exist.
     *
     * @param {string} filename  Name of the file to remove.
     * @param {boolean} [ignoreErrorCodes=false]  Ignore error return codes.
     * @returns {Promise<PositiveResponse>}
     */
    remove(filename, ignoreErrorCodes = false) {
        return this.send("DELE " + filename, ignoreErrorCodes);
    }

    /**
     * Report transfer progress for any upload or download to a given handler.
     *
     * This will also reset the overall transfer counter that can be used for multiple transfers. You can
     * also pass `undefined` as a handler to stop reporting to an earlier one.
     *
     * @param {((info: import("./ProgressTracker").ProgressInfo) => void)} [handler=undefined]  Handler function to call on transfer progress.
     */
    trackProgress(handler) {
        this._progressTracker.bytesOverall = 0;
        this._progressTracker.reportTo(handler);
    }

    /**
     * Upload data from a readable stream and store it as a file with a given filename in the current working directory.
     *
     * @param {import("stream").Readable} readableStream  The stream to read from.
     * @param {string} remoteFilename  The filename of the remote file to write to.
     * @returns {Promise<PositiveResponse>}
     */
    async upload(readableStream, remoteFilename) {
        await this.prepareTransfer(this);
        return upload(this.ftp, this._progressTracker, readableStream, remoteFilename);
    }

    /**
     * Download a file with a given filename from the current working directory
     * and pipe its data to a writable stream. You may optionally start at a specific
     * offset, for example to resume a cancelled transfer.
     *
     * @param {import("stream").Writable} writableStream  The stream to write to.
     * @param {string} remoteFilename  The name of the remote file to read from.
     * @param {number} [startAt=0]  The offset to start at.
     * @returns {Promise<PositiveResponse>}
     */
    async download(writableStream, remoteFilename, startAt = 0) {
        await this.prepareTransfer(this);
        const command = startAt > 0 ? `REST ${startAt}` : `RETR ${remoteFilename}`;
        return download(this.ftp, this._progressTracker, writableStream, command, remoteFilename);
    }

    /**
     * List files and directories in the current working directory.
     *
     * @returns {Promise<FileInfo[]>}
     */
    async list() {
        await this.prepareTransfer(this);
        const writable = new StringWriter();
        const progressTracker = nullObject(); // Don't track progress of list transfers.
        //@ts-ignore that progressTracker is not really of type ProgressTracker.
        await download(this.ftp, progressTracker, writable, "LIST -a");
        const text = writable.getText(this.ftp.encoding);
        this.ftp.log(text);
        return this.parseList(text);
    }

    /**
     * Remove a directory and all of its content.
     *
     * After successfull completion the current working directory will be the parent
     * of the removed directory if possible.
     *
     * @param {string} remoteDirPath  The path of the remote directory to delete.
     * @example client.removeDir("foo") // Remove directory 'foo' using a relative path.
     * @example client.removeDir("foo/bar") // Remove directory 'bar' using a relative path.
     * @example client.removeDir("/foo/bar") // Remove directory 'bar' using an absolute path.
     * @example client.removeDir("/") // Remove everything.
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
     * Upload the contents of a local directory to the working directory.
     *
     * You can optionally provide a `remoteDirName` to put the contents inside a directory which
     * will be created if necessary. This will overwrite existing files with the same names and
     * reuse existing directories. Unrelated files and directories will remain untouched.
     *
     * @param {string} localDirPath  A local path, e.g. "foo/bar" or "../test"
     * @param {string} [remoteDirName]  The name of the remote directory. If undefined, directory contents will be uploaded to the working directory.
     * @returns {Promise<void>}
     */
    async uploadDir(localDirPath, remoteDirName = undefined) {
        // If a remote directory name has been provided, create it and cd into it.
        if (remoteDirName !== undefined) {
            if (remoteDirName.indexOf("/") !== -1) {
                throw new Error(`Path provided '${remoteDirName}' instead of single directory name.`);
            }
            await openDir(this, remoteDirName);
        }
        await uploadDirContents(this, localDirPath);
        // The working directory should stay the same after this operation.
        if (remoteDirName !== undefined) {
            await this.send("CDUP");
        }
    }

    /**
     * Download all files and directories of the working directory to a local directory.
     *
     * @param {string} localDirPath  The local directory to download to.
     * @returns {Promise<void>}
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
     * Make sure a given remote path exists, creating all directories as necessary.
     * This function also changes the current working directory to the given path.
     *
     * @param {string} remoteDirPath
     * @returns {Promise<void>}
     */
    async ensureDir(remoteDirPath) {
        // If the remoteDirPath was absolute go to root directory.
        if (remoteDirPath.startsWith("/")) {
            await this.cd("/");
        }
        const names = remoteDirPath.split("/").filter(name => name !== "");
        for (const name of names) {
            await openDir(this, name);
        }
    }
}

/**
 * Resolves a given task if one party has provided a result and another one confirmed it.
 *
 * This is used internally for all FTP transfers. For example when downloading, the server might confirm
 * with "226 Transfer complete" when in fact the download on the data connection has not finished
 * yet. With all transfers we make sure that a) the result arrived and b) has been confirmed by
 * e.g. the control connection. We just don't know in which order this will happen.
 */
class TransferResolver {

    /**
     * Instantiate a TransferResolver
     * @param {FTPContext} ftp
     */
    constructor(ftp) {
        /** @type {FTPContext} */
        this.ftp = ftp;
        /** @type {(import("./FtpContext").FTPResponse | undefined)} */
        this.response = undefined;
        /** @type {boolean} */
        this.confirmed = false;
    }

    /**
     * @param {import("./FtpContext").TaskResolver} task
     */
    confirm(task) {
        this.confirmed = true;
        this._tryResolve(task);
    }

    /**
     * @param {import("./FtpContext").TaskResolver} task
     * @param {Error} err
     */
    reject(task, err) {
        this.ftp.dataSocket = undefined;
        task.reject(err);
    }

    /**
     * @param {import("./FtpContext").TaskResolver} task
     * @param {import("./FtpContext").FTPResponse} response
     */
    resolve(task, response) {
        this.response = response;
        this._tryResolve(task);
    }

    /**
     * @param {import("./FtpContext").TaskResolver} task
     */
    _tryResolve(task) {
        if (this.confirmed && this.response !== undefined) {
            this.ftp.dataSocket = undefined;
            task.resolve(this.response);
        }
    }
}

module.exports = {
    Client,
    FTPContext,
    FTPError,
    FileInfo,
    // Expose some utilities for custom extensions:
    utils: {
        upgradeSocket,
        parseIPv4PasvResponse,
        TransferResolver
    },
    // enterFirstCompatibleMode,
    // enterPassiveModeIPv4,
    // enterPassiveModeIPv6,
};

/**
 * Return true if an FTP return code describes a positive completion. Often it's not
 * necessary to know which code it was specifically.
 *
 * @param {number} code
 * @returns {boolean}
 */
function positiveCompletion(code) {
    return code >= 200 && code < 300;
}

/**
 * Returns true if an FTP response line is the beginning of a multiline response.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isMultiline(line) {
    return /^\d\d\d-/.test(line);
}

/**
 * Returns a string describing the encryption on a given socket instance.
 *
 * @param {(net.Socket | tls.TLSSocket)} socket
 * @returns {string}
 */
function describeTLS(socket) {
    if (socket instanceof tls.TLSSocket) {
        return socket.getProtocol();
    }
    return "No encryption";
}

/**
 * Returns a string describing the remote address of a socket.
 *
 * @param {net.Socket} socket
 * @returns {string}
 */
function describeAddress(socket) {
    if (socket.remoteFamily === "IPv6") {
        return `[${socket.remoteAddress}]:${socket.remotePort}`;
    }
    return `${socket.remoteAddress}:${socket.remotePort}`;
}

/**
 * Upgrade a socket connection with TLS.
 *
 * @param {net.Socket} socket
 * @param {tls.ConnectionOptions} options Same options as in `tls.connect(options)`
 * @returns {Promise<tls.TLSSocket>}
 */
function upgradeSocket(socket, options) {
    return new Promise((resolve, reject) => {
        const tlsOptions = Object.assign({}, options, {
            socket // Establish the secure connection using an existing socket connection.
        });
        const tlsSocket = tls.connect(tlsOptions, () => {
            // Make sure the certificate is valid if an unauthorized one should be rejected.
            const expectCertificate = tlsOptions.rejectUnauthorized !== false;
            if (expectCertificate && !tlsSocket.authorized) {
                reject(tlsSocket.authorizationError);
            }
            else {
                // Remove error listener below.
                tlsSocket.removeAllListeners("error");
                resolve(tlsSocket);
            }
        }).once("error", error => {
            reject(error);
        });
    });
}

/**
 * Try all available transfer strategies and pick the first one that works. Update `client` to
 * use the working strategy for all successive transfer requests.
 *
 * @param {((client: Client)=>Promise<PositiveResponse>)[]} strategies
 * @returns {(client: Client)=>Promise<PositiveResponse>} a function that will try the provided strategies.
 */
function enterFirstCompatibleMode(...strategies) {
    return async function autoDetect(client) {
        client.ftp.log("Trying to find optimal transfer strategy...");
        for (const strategy of strategies) {
            try {
                const res = await strategy(client);
                client.ftp.log("Optimal transfer strategy found.");
                client.prepareTransfer = strategy; // First strategy that works will be used from now on.
                return res;
            }
            catch(err) {
                // Receiving an FTPError means that the last transfer strategy failed and we should
                // try the next one. Any other exception should stop the evaluation of strategies because
                // something else went wrong.
                if (!(err instanceof FTPError)) {
                    throw err;
                }
            }
        }
        throw new Error("None of the available transfer strategies work.");
    };
}

/**
 * Prepare a data socket using passive mode over IPv6.
 *
 * @param {Client} client
 * @returns {Promise<PositiveResponse>}
 */
async function enterPassiveModeIPv6(client) {
    const res = await client.send("EPSV");
    const port = parseIPv6PasvResponse(res.message);
    if (!port) {
        throw new Error("Can't parse EPSV response: " + res.message);
    }
    const controlHost = client.ftp.socket.remoteAddress;
    await connectForPassiveTransfer(controlHost, port, client.ftp);
    return res;
}

/**
 * Parse an EPSV response. Returns only the port as in EPSV the host of the control connection is used.
 *
 * @param {string} message
 * @returns {number} port
 */
function parseIPv6PasvResponse(message) {
    // Get port from EPSV response, e.g. "229 Entering Extended Passive Mode (|||6446|)"
    const groups = message.match(/\|{3}(.+)\|/);
    return groups[1] ? parseInt(groups[1], 10) : undefined;
}

/**
 * Prepare a data socket using passive mode over IPv4.
 *
 * @param {Client} client
 * @returns {Promise<PositiveResponse>}
 */
async function enterPassiveModeIPv4(client) {
    const res = await client.send("PASV");
    const target = parseIPv4PasvResponse(res.message);
    if (!target) {
        throw new Error("Can't parse PASV response: " + res.message);
    }
    // If the host in the PASV response has a local address while the control connection hasn't,
    // we assume a NAT issue and use the IP of the control connection as the target for the data connection.
    // We can't always perform this replacement because it's possible (although unlikely) that the FTP server
    // indeed uses a different host for data connections.
    if (ipIsPrivateV4Address(target.host) && !ipIsPrivateV4Address(client.ftp.socket.remoteAddress)) {
        target.host = client.ftp.socket.remoteAddress;
    }
    await connectForPassiveTransfer(target.host, target.port, client.ftp);
    return res;
}

/**
 * Parse a PASV response.
 *
 * @param {string} message
 * @returns {{host: string, port: number}}
 */
function parseIPv4PasvResponse(message) {
    // Get host and port from PASV response, e.g. "227 Entering Passive Mode (192,168,1,100,10,229)"
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
 * Returns true if an IP is a private address according to https://tools.ietf.org/html/rfc1918#section-3.
 * This will handle IPv4-mapped IPv6 addresses correctly but return false for all other IPv6 addresses.
 *
 * @param {string} ip  The IP as a string, e.g. "192.168.0.1"
 * @returns {boolean} true if the ip is local.
 */
function ipIsPrivateV4Address(ip = "") {
    // Handle IPv4-mapped IPv6 addresses like ::ffff:192.168.0.1
    if (ip.startsWith("::ffff:")) {
        ip = ip.substr(7); // Strip ::ffff: prefix
    }
    const octets = ip.split(".").map(o => parseInt(o, 10));
    return octets[0] === 10                                             // 10.0.0.0 - 10.255.255.255
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)    // 172.16.0.0 - 172.31.255.255
        || (octets[0] === 192 && octets[1] === 168);                    // 192.168.0.0 - 192.168.255.255
}

function connectForPassiveTransfer(host, port, ftp) {
    return new Promise((resolve, reject) => {
        const handleConnErr = function(err) {
            reject("Can't open data connection in passive mode: " + err.message);
        };
        let socket = new net.Socket();
        socket.on("error", handleConnErr);
        socket.connect({ port, host, family: ftp.ipFamily }, () => {
            if (ftp.hasTLS) {
                socket = tls.connect(Object.assign({}, ftp.tlsOptions, {
                    // Upgrade the existing socket connection.
                    socket,
                    // Reuse the TLS session negotiated earlier when the control connection
                    // was upgraded. Servers expect this because it provides additional
                    // security. If a completely new session would be negotiated, a hacker
                    // could guess the port and connect to the new data connection before we do
                    // by just starting his/her own TLS session.
                    session: ftp.socket.getSession()
                }));
                // It's the responsibility of the transfer task to wait until the
                // TLS socket issued the event 'secureConnect'. We can't do this
                // here because some servers will start upgrading after the
                // specific transfer request has been made. List and download don't
                // have to wait for this event because the server sends whenever it
                // is ready. But for upload this has to be taken into account,
                // see the details in the upload() function below.
            }
            // Let the FTPContext listen to errors from now on, remove local handler.
            socket.removeListener("error", handleConnErr);
            ftp.dataSocket = socket;
            resolve();
        });
    });
}

/**
 * Upload stream data as a file. For example:
 *
 * `upload(ftp, fs.createReadStream(localFilePath), remoteFilename)`
 *
 * @param {FTPContext} ftp
 * @param {ProgressTracker} progress
 * @param {import("stream").Readable} readableStream
 * @param {string} remoteFilename
 * @returns {Promise<PositiveResponse>}
 */
function upload(ftp, progress, readableStream, remoteFilename) {
    const resolver = new TransferResolver(ftp);
    const command = "STOR " + remoteFilename;
    return ftp.handle(command, (err, res, task) => {
        if (err) {
            ftp.enableControlTimeout(true);
            progress.updateAndStop();
            resolver.reject(task, err);
        }
        else if (res.code === 150 || res.code === 125) { // Ready to upload
            // If we are using TLS, we have to wait until the dataSocket issued
            // 'secureConnect'. If this hasn't happened yet, getCipher() returns undefined.
            // @ts-ignore that ftp.dataSocket might be just a Socket without getCipher()
            const canUpload = ftp.hasTLS === false || ftp.dataSocket.getCipher() !== undefined;
            onConditionOrEvent(canUpload, ftp.dataSocket, "secureConnect", () => {
                ftp.log(`Uploading to ${describeAddress(ftp.dataSocket)} (${describeTLS(ftp.dataSocket)})`);
                // Let the data socket be in charge of tracking timeouts.
                // The control socket sits idle during this time anyway and might provoke
                // a timeout unnecessarily. The control connection will take care
                // of timeouts again once data transfer is complete or failed.
                ftp.enableControlTimeout(false);
                progress.start(ftp.dataSocket, remoteFilename, "upload");
                readableStream.pipe(ftp.dataSocket).once("finish", () => {
                    ftp.dataSocket.destroy(); // Explicitly close/destroy the socket to signal the end.
                    ftp.enableControlTimeout(true);
                    progress.updateAndStop();
                    resolver.confirm(task);
                });
            });
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.resolve(task, res);
        }
        // Ignore any other FTP response
    });
}

/**
 * Download data from the data connection. Used for downloading files and directory listings.
 *
 * @param {FTPContext} ftp
 * @param {ProgressTracker} progress
 * @param {import("stream").Writable} writableStream
 * @param {string} command
 * @param {string} [remoteFilename]
 * @returns {Promise<PositiveResponse>}
 */
function download(ftp, progress, writableStream, command, remoteFilename = "") {
    // It's possible that data transmission begins before the control socket
    // receives the announcement. Start listening for data immediately.
    ftp.dataSocket.pipe(writableStream);
    const resolver = new TransferResolver(ftp);
    return ftp.handle(command, (err, res, task) => {
        if (err) {
            ftp.enableControlTimeout(true);
            progress.updateAndStop();
            resolver.reject(task, err);
        }
        else if (res.code === 150 || res.code === 125) { // Ready to download
            ftp.log(`Downloading from ${describeAddress(ftp.dataSocket)} (${describeTLS(ftp.dataSocket)})`);
            // Let the data connection be in charge of tracking timeouts during transfer.
            ftp.enableControlTimeout(false);
            progress.start(ftp.dataSocket, remoteFilename, "download");
            // Confirm the transfer as soon as the data socket transmission ended.
            // It's possible, though, that the data transmission is complete before
            // the control socket receives the accouncement that it will begin.
            // Check if the data socket is not already closed.
            onConditionOrEvent(ftp.dataSocket.destroyed, ftp.dataSocket, "end", () => {
                ftp.enableControlTimeout(true);
                progress.updateAndStop();
                resolver.confirm(task);
            });
        }
        else if (res.code === 350) { // Restarting at startAt.
            ftp.send("RETR " + remoteFilename);
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.resolve(task, res);
        }
        // Ignore any other FTP response
    });
}

/**
 * Calls a function immediately if a condition is met or subscribes to an event and calls
 * it once the event is emitted.
 *
 * @param {boolean} condition  The condition to test.
 * @param {*} emitter  The emitter to use if the condition is not met.
 * @param {string} eventName  The event to subscribe to if the condition is not met.
 * @param {() => any} action  The function to call.
 */
function onConditionOrEvent(condition, emitter, eventName, action) {
    if (condition === true) {
        action();
    }
    else {
        emitter.once(eventName, () => action());
    }
}

/**
 * Upload the contents of a local directory to the working directory. This will overwrite
 * existing files and reuse existing directories.
 *
 * @param {string} localDirPath
 */
async function uploadDirContents(client, localDirPath) {
    const files = await fsReadDir(localDirPath);
    for (const file of files) {
        const fullPath = path.join(localDirPath, file);
        const stats = await fsStat(fullPath);
        if (stats.isFile()) {
            await client.upload(fs.createReadStream(fullPath), file);
        }
        else if (stats.isDirectory()) {
            await openDir(client, file);
            await uploadDirContents(client, fullPath);
            await client.send("CDUP");
        }
    }
}

/**
 * Try to create a directory and enter it. This will not raise an exception if the directory
 * couldn't be created if for example it already exists.
 *
 * @param {Client} client
 * @param {string} dirName
 */
async function openDir(client, dirName) {
    await client.send("MKD " + dirName, true); // Ignore FTP error codes
    await client.cd(dirName);
}

async function ensureLocalDirectory(path) {
    try {
        await fsStat(path);
    }
    catch(err) {
        await fsMkDir(path);
    }
}
