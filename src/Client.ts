import { EventEmitter } from "events"
import { createReadStream, createWriteStream, mkdir, readdir, stat } from "fs"
import { Socket } from "net"
import { join } from "path"
import { Readable, Writable } from "stream"
import { connect as connectTLS, ConnectionOptions, TLSSocket } from "tls"
import { promisify } from "util"
import { FileInfo } from "./FileInfo"
import { FTPContext, FTPError, FTPResponse, TaskResolver } from "./FtpContext"
import { createNullObject } from "./nullObject"
import { parseList as parseListAutoDetect } from "./parseList"
import { ProgressHandler, ProgressTracker } from "./ProgressTracker"
import { StringWriter } from "./StringWriter"

const fsReadDir = promisify(readdir)
const fsMkDir = promisify(mkdir)
const fsStat = promisify(stat)

export interface AccessOptions {
    /** Host the client should connect to. Optional, default is "localhost". */
    readonly host?: string
    /** Port the client should connect to. Optional, default is 21. */
    readonly port?: number
    /** Username to use for login. Optional, default is "anonymous". */
    readonly user?: string
    /** Password to use for login. Optional, default is "guest". */
    readonly password?: string
    /** Use explicit FTPS over TLS. Optional, default is false. */
    readonly secure?: boolean
    /** TLS options as in `tls.connect(options)`, optional. */
    readonly secureOptions?: ConnectionOptions
}

export type TransferStrategy = (client: Client) => Promise<FTPResponse>

export type RawListParser = (rawList: string) => FileInfo[]

/**
 * Client offers an API to interact with an FTP server.
 */
export class Client {
    /** FTP context handling low-level tasks. */
    readonly ftp: FTPContext
    /** Function that prepares a data connection for transfer. */
    prepareTransfer: TransferStrategy
    /** Function that parses raw directoy listing data. */
    parseList: RawListParser
    /** Tracks progress of data transfers. */
    protected progressTracker: ProgressTracker

    /**
     * Instantiate an FTP client.
     *
     * @param timeout  Timeout in milliseconds, use 0 for no timeout. Optional, default is 30 seconds.
     */
    constructor(timeout = 30000) {
        this.ftp = new FTPContext(timeout)
        this.prepareTransfer = enterFirstCompatibleMode(enterPassiveModeIPv6, enterPassiveModeIPv4)
        this.parseList = parseListAutoDetect
        this.progressTracker = new ProgressTracker()
    }

    /**
     * Close the client and all open socket connections.
     *
     * The client can’t be used anymore after calling this method, you have to instantiate a new one to continue any work.
     */
    close() {
        this.ftp.close()
        this.progressTracker.stop()
    }

    /**
     * Returns true if the client is closed and can't be used anymore.
     */
    get closed(): boolean {
        return this.ftp.closed
    }

    /**
     * Connect to an FTP server.
     *
     * @param host  Host the client should connect to. Optional, default is "localhost".
     * @param port  Port the client should connect to. Optional, default is 21.
     */
    connect(host = "localhost", port = 21): Promise<FTPResponse> {
        this.ftp.socket.connect({
            host,
            port,
            family: this.ftp.ipFamily
        }, () => this.ftp.log(`Connected to ${describeAddress(this.ftp.socket)}`))
        return this.ftp.handle(undefined, (res, task) => {
            if (res instanceof Error) {
                task.reject(res)
            }
            else if (positiveCompletion(res.code)) {
                task.resolve(res)
            }
            else {
                // Reject all other codes, including 120 "Service ready in nnn minutes".
                task.reject(new FTPError(res))
            }
        })
    }

    /**
     * Send an FTP command.
     *
     * If successful it will return a response object that contains the return code as well
     * as the whole message. Ignore FTP error codes if you don't want an exception to be thrown
     * if an FTP command didn't succeed.
     *
     * @param command  FTP command to send.
     * @param ignoreErrorCodes  Whether to ignore FTP error codes in result. Optional, default is false.
     */
    send(command: string, ignoreErrorCodes = false): Promise<FTPResponse> {
        return this.ftp.handle(command, (res, task) => {
            if (res instanceof FTPError) {
                if (ignoreErrorCodes) {
                    task.resolve({code: res.code, message: res.message})
                }
                else {
                    task.reject(res)
                }
            }
            else if (res instanceof Error) {
                task.reject(res)
            }
            else {
                task.resolve(res)
            }
        })
    }

    /**
     * Upgrade the current socket connection to TLS.
     *
     * @param options  TLS options as in `tls.connect(options)`, optional.
     * @param command  Set the authentication command. Optional, default is "AUTH TLS".
     */
    async useTLS(options: ConnectionOptions = {}, command = "AUTH TLS"): Promise<FTPResponse> {
        const ret = await this.send(command)
        this.ftp.socket = await upgradeSocket(this.ftp.socket, options)
        this.ftp.tlsOptions = options // Keep the TLS options for later data connections that should use the same options.
        this.ftp.log(`Control socket is using: ${describeTLS(this.ftp.socket)}`)
        return ret
    }

    /**
     * Login a user with a password.
     *
     * @param user  Username to use for login. Optional, default is "anonymous".
     * @param password  Password to use for login. Optional, default is "guest".
     */
    login(user = "anonymous", password = "guest"): Promise<FTPResponse> {
        this.ftp.log(`Login security: ${describeTLS(this.ftp.socket)}`)
        return this.ftp.handle("USER " + user, (res, task) => {
            if (res instanceof Error) {
                task.reject(res)
            }
            else if (positiveCompletion(res.code)) { // User logged in proceed OR Command superfluous
                task.resolve(res)
            }
            else if (res.code === 331) { // User name okay, need password
                this.ftp.send("PASS " + password)
            }
            else { // Also report error on 332 (Need account)
                task.reject(new FTPError(res))
            }
        })
    }

    /**
     * Set the usual default settings.
     *
     * Settings used:
     * * Binary mode (TYPE I)
     * * File structure (STRU F)
     * * Additional settings for FTPS (PBSZ 0, PROT P)
     */
    async useDefaultSettings(): Promise<void> {
        await this.send("TYPE I") // Binary mode
        await this.send("STRU F") // Use file structure
        if (this.ftp.hasTLS) {
            await this.send("PBSZ 0") // Set to 0 for TLS
            await this.send("PROT P") // Protect channel (also for data connections)
        }
    }

    /**
     * Convenience method that calls `connect`, `useTLS`, `login` and `useDefaultSettings`.
     */
    async access(options: AccessOptions = {}): Promise<FTPResponse> {
        const welcome = await this.connect(options.host, options.port)
        if (options.secure === true) {
            await this.useTLS(options.secureOptions)
        }
        await this.login(options.user, options.password)
        await this.useDefaultSettings()
        return welcome
    }

    /**
     * Set the working directory.
     */
    cd(path: string): Promise<FTPResponse> {
        return this.send("CWD " + path)
    }

    /**
     * Get the current working directory.
     */
    async pwd(): Promise<string> {
        const res = await this.send("PWD")
        // The directory is part of the return message, for example:
        // 257 "/this/that" is current directory.
        const parsed = res.message.match(/"(.+)"/)
        if (parsed === null || parsed[1] === undefined) {
            throw new Error(`Can't parse response to command 'PWD': ${res.message}`)
        }
        return parsed[1]
    }

    /**
     * Get the last modified time of a file. Not supported by every FTP server, method might throw exception.
     */
    async lastMod(filename: string): Promise<Date> {
        const res = await this.send("MDTM " + filename)
        // Message contains response code and modified time in the format: YYYYMMDDHHMMSS[.sss]
        // For example `213 19991005213102` or `213 19980615100045.014`.
        const msg = res.message
        const date = new Date()
        date.setUTCFullYear(+msg.slice(4, 8), +msg.slice(8, 10) - 1, +msg.slice(10, 12))
        date.setUTCHours(+msg.slice(12, 14), +msg.slice(14, 16), +msg.slice(16, 18), +msg.slice(19, 22))
        return date
    }

    /**
     * Get a description of supported features.
     *
     * This sends the FEAT command and parses the result into a Map where keys correspond to available commands
     * and values hold further information. Be aware that your FTP servers might not support this
     * command in which case this method will not throw an exception but just return an empty Map.
     */
    async features(): Promise<Map<string, string>> {
        const res = await this.send("FEAT", true)
        const features = new Map()
        // Not supporting any special features will be reported with a single line.
        if (res.code < 400 && isMultiline(res.message)) {
            // The first and last line wrap the multiline response, ignore them.
            res.message.split("\n").slice(1, -1).forEach(line => {
                // A typical lines looks like: " REST STREAM" or " MDTM".
                // Servers might not use an indentation though.
                const entry = line.trim().split(" ")
                features.set(entry[0], entry[1] || "")
            })
        }
        return features
    }

    /**
     * Get the size of a file.
     */
    async size(filename: String): Promise<number> {
        const res = await this.send("SIZE " + filename)
        // The size is part of the response message, for example: "213 555555"
        const size = parseInt(res.message.slice(4), 10)
        if (Number.isNaN(size)) {
            throw new Error(`Can't parse response to command 'SIZE ${filename}' as a numerical value: ${res.message}`)
        }
        return size
    }

    /**
     * Rename a file.
     *
     * Depending on the FTP server this might also be used to move a file from one
     * directory to another by providing full paths.
     */
    async rename(path: string, newPath: string): Promise<FTPResponse> {
        await this.send("RNFR " + path)
        return this.send("RNTO " + newPath)
    }

    /**
     * Remove a file from the current working directory.
     *
     * You can ignore FTP error return codes which won't throw an exception if e.g.
     * the file doesn't exist.
     */
    remove(filename: string, ignoreErrorCodes = false): Promise<FTPResponse> {
        return this.send("DELE " + filename, ignoreErrorCodes)
    }

    /**
     * Report transfer progress for any upload or download to a given handler.
     *
     * This will also reset the overall transfer counter that can be used for multiple transfers. You can
     * also pass `undefined` as a handler to stop reporting to an earlier one.
     *
     * @param handler  Handler function to call on transfer progress.
     */
    trackProgress(handler: ProgressHandler) {
        this.progressTracker.bytesOverall = 0
        this.progressTracker.reportTo(handler)
    }

    /**
     * Upload data from a readable stream and store it as a file with a given filename in the current working directory.
     *
     * @param source  The stream to read from.
     * @param remoteFilename  The filename of the remote file to write to.
     */
    async upload(source: Readable, remoteFilename: string): Promise<FTPResponse> {
        await this.prepareTransfer(this)
        return upload(this.ftp, this.progressTracker, source, remoteFilename)
    }

    /**
     * Download a file with a given filename from the current working directory
     * and pipe its data to a writable stream. You may optionally start at a specific
     * offset, for example to resume a cancelled transfer.
     *
     * @param destination  The stream to write to.
     * @param remoteFilename  The name of the remote file to read from.
     * @param startAt  The offset to start at.
     */
    async download(destination: Writable, remoteFilename: string, startAt = 0): Promise<FTPResponse> {
        await this.prepareTransfer(this)
        const command = startAt > 0 ? `REST ${startAt}` : `RETR ${remoteFilename}`
        return download(this.ftp, this.progressTracker, destination, command, remoteFilename)
    }

    /**
     * List files and directories in the current working directory.
     */
    async list(): Promise<FileInfo[]> {
        await this.prepareTransfer(this)
        const writable = new StringWriter()
        const progressTracker = createNullObject() as ProgressTracker // Don't track progress of list transfers.
        await download(this.ftp, progressTracker, writable, "LIST -a")
        const text = writable.getText(this.ftp.encoding)
        this.ftp.log(text)
        return this.parseList(text)
    }

    /**
     * Remove a directory and all of its content.
     *
     * After successfull completion the current working directory will be the parent
     * of the removed directory if possible.
     *
     * @param remoteDirPath  The path of the remote directory to delete.
     * @example client.removeDir("foo") // Remove directory 'foo' using a relative path.
     * @example client.removeDir("foo/bar") // Remove directory 'bar' using a relative path.
     * @example client.removeDir("/foo/bar") // Remove directory 'bar' using an absolute path.
     * @example client.removeDir("/") // Remove everything.
     */
    async removeDir(remoteDirPath: string): Promise<void> {
        await this.cd(remoteDirPath)
        await this.clearWorkingDir()
        // Remove the directory itself if we're not already on root.
        const workingDir = await this.pwd()
        if (workingDir !== "/") {
            await this.send("CDUP")
            await this.send("RMD " + remoteDirPath)
        }
    }

    /**
     * Remove all files and directories in the working directory without removing
     * the working directory itself.
     */
    async clearWorkingDir(): Promise<void> {
        for (const file of await this.list()) {
            if (file.isDirectory) {
                await this.cd(file.name)
                await this.clearWorkingDir()
                await this.send("CDUP")
                await this.send("RMD " + file.name)
            }
            else {
                await this.send("DELE " + file.name)
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
     * @param localDirPath  A local path, e.g. "foo/bar" or "../test"
     * @param remoteDirName  The name of the remote directory. If undefined, directory contents will be uploaded to the working directory.
     */
    async uploadDir(localDirPath: string, remoteDirName?: string): Promise<void> {
        // If a remote directory name has been provided, create it and cd into it.
        if (remoteDirName !== undefined) {
            if (remoteDirName.indexOf("/") !== -1) {
                throw new Error(`Path provided '${remoteDirName}' instead of single directory name.`)
            }
            await openDir(this, remoteDirName)
        }
        await uploadDirContents(this, localDirPath)
        // The working directory should stay the same after this operation.
        if (remoteDirName !== undefined) {
            await this.send("CDUP")
        }
    }

    /**
     * Download all files and directories of the working directory to a local directory.
     *
     * @param localDirPath  The local directory to download to.
     */
    async downloadDir(localDirPath: string): Promise<void> {
        await ensureLocalDirectory(localDirPath)
        for (const file of await this.list()) {
            const localPath = join(localDirPath, file.name)
            if (file.isDirectory) {
                await this.cd(file.name)
                await this.downloadDir(localPath)
                await this.send("CDUP")
            }
            else {
                const writable = createWriteStream(localPath)
                await this.download(writable, file.name)
            }
        }
    }

    /**
     * Make sure a given remote path exists, creating all directories as necessary.
     * This function also changes the current working directory to the given path.
     */
    async ensureDir(remoteDirPath: string): Promise<void> {
        // If the remoteDirPath was absolute go to root directory.
        if (remoteDirPath.startsWith("/")) {
            await this.cd("/")
        }
        const names = remoteDirPath.split("/").filter(name => name !== "")
        for (const name of names) {
            await openDir(this, name)
        }
    }
}

/**
 * Return true if an FTP return code describes a positive completion.
 */
function positiveCompletion(code: number): boolean {
    return code >= 200 && code < 300
}

/**
 * Return true if an FTP return code describes a positive intermediate response.
 */
function positiveIntermediate(code: number): boolean {
    return code >= 300 && code < 400
}

/**
 * Returns true if an FTP response line is the beginning of a multiline response.
 */
function isMultiline(line: string): boolean {
    return /^\d\d\d-/.test(line)
}

/**
 * Returns a string describing the encryption on a given socket instance.
 */
function describeTLS(socket: Socket | TLSSocket): string {
    if (socket instanceof TLSSocket) {
        const protocol = socket.getProtocol()
        return protocol ? protocol : "Server socket or disconnected client socket"
    }
    return "No encryption"
}

/**
 * Returns a string describing the remote address of a socket.
 */
function describeAddress(socket: Socket): string {
    if (socket.remoteFamily === "IPv6") {
        return `[${socket.remoteAddress}]:${socket.remotePort}`
    }
    return `${socket.remoteAddress}:${socket.remotePort}`
}

/**
 * Upgrade a socket connection with TLS.
 */
function upgradeSocket(socket: Socket, options: ConnectionOptions): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
        const tlsOptions = Object.assign({}, options, {
            socket // Establish the secure connection using an existing socket connection.
        })
        const tlsSocket = connectTLS(tlsOptions, () => {
            // Make sure the certificate is valid if an unauthorized one should be rejected.
            const expectCertificate = tlsOptions.rejectUnauthorized !== false
            if (expectCertificate && !tlsSocket.authorized) {
                reject(tlsSocket.authorizationError)
            }
            else {
                // Remove error listener below.
                tlsSocket.removeAllListeners("error")
                resolve(tlsSocket)
            }
        }).once("error", error => {
            reject(error)
        })
    })
}

/**
 * Try all available transfer strategies and pick the first one that works. Update `client` to
 * use the working strategy for all successive transfer requests.
 *
 * @param strategies
 * @returns a function that will try the provided strategies.
 */
function enterFirstCompatibleMode(...strategies: TransferStrategy[]): TransferStrategy {
    return async function autoDetect(client) {
        client.ftp.log("Trying to find optimal transfer strategy...")
        for (const strategy of strategies) {
            try {
                const res = await strategy(client)
                client.ftp.log("Optimal transfer strategy found.")
                client.prepareTransfer = strategy // First strategy that works will be used from now on.
                return res
            }
            catch(err) {
                // Receiving an FTPError means that the last transfer strategy failed and we should
                // try the next one. Any other exception should stop the evaluation of strategies because
                // something else went wrong.
                if (!(err instanceof FTPError)) {
                    throw err
                }
            }
        }
        throw new Error("None of the available transfer strategies work.")
    }
}

/**
 * Prepare a data socket using passive mode over IPv6.
 */
async function enterPassiveModeIPv6(client: Client): Promise<FTPResponse> {
    const res = await client.send("EPSV")
    const port = parseIPv6PasvResponse(res.message)
    if (!port) {
        throw new Error("Can't parse EPSV response: " + res.message)
    }
    const controlHost = client.ftp.socket.remoteAddress
    if (controlHost === undefined) {
        throw new Error("Control socket is disconnected, can't get remote address.")
    }
    await connectForPassiveTransfer(controlHost, port, client.ftp)
    return res
}

/**
 * Parse an EPSV response. Returns only the port as in EPSV the host of the control connection is used.
 */
function parseIPv6PasvResponse(message: string): number {
    // Get port from EPSV response, e.g. "229 Entering Extended Passive Mode (|||6446|)"
    const groups = message.match(/\|{3}(.+)\|/)
    if (groups === null || groups[1] === undefined) {
        throw new Error(`Can't parse response to 'EPSV': ${message}`)
    }
    const port = parseInt(groups[1], 10)
    if (Number.isNaN(port)) {
        throw new Error(`Can't parse response to 'EPSV', port is not a number: ${message}`)
    }
    return port
}

/**
 * Prepare a data socket using passive mode over IPv4.
 */
async function enterPassiveModeIPv4(client: Client): Promise<FTPResponse> {
    const res = await client.send("PASV")
    const target = parseIPv4PasvResponse(res.message)
    if (!target) {
        throw new Error("Can't parse PASV response: " + res.message)
    }
    // If the host in the PASV response has a local address while the control connection hasn't,
    // we assume a NAT issue and use the IP of the control connection as the target for the data connection.
    // We can't always perform this replacement because it's possible (although unlikely) that the FTP server
    // indeed uses a different host for data connections.
    const controlHost = client.ftp.socket.remoteAddress
    if (ipIsPrivateV4Address(target.host) && controlHost && !ipIsPrivateV4Address(controlHost)) {
        target.host = controlHost
    }
    await connectForPassiveTransfer(target.host, target.port, client.ftp)
    return res
}

/**
 * Parse a PASV response.
 */
function parseIPv4PasvResponse(message: string): { host: string, port: number } {
    // Get host and port from PASV response, e.g. "227 Entering Passive Mode (192,168,1,100,10,229)"
    const groups = message.match(/([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/)
    if (groups === null || groups.length !== 4) {
        throw new Error(`Can't parse response to 'PASV': ${message}`)
    }
    return {
        host: groups[1].replace(/,/g, "."),
        port: (parseInt(groups[2], 10) & 255) * 256 + (parseInt(groups[3], 10) & 255)
    }
}

/**
 * Returns true if an IP is a private address according to https://tools.ietf.org/html/rfc1918#section-3.
 * This will handle IPv4-mapped IPv6 addresses correctly but return false for all other IPv6 addresses.
 *
 * @param ip  The IP as a string, e.g. "192.168.0.1"
 */
function ipIsPrivateV4Address(ip = ""): boolean {
    // Handle IPv4-mapped IPv6 addresses like ::ffff:192.168.0.1
    if (ip.startsWith("::ffff:")) {
        ip = ip.substr(7) // Strip ::ffff: prefix
    }
    const octets = ip.split(".").map(o => parseInt(o, 10))
    return octets[0] === 10                                             // 10.0.0.0 - 10.255.255.255
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)    // 172.16.0.0 - 172.31.255.255
        || (octets[0] === 192 && octets[1] === 168)                    // 192.168.0.0 - 192.168.255.255
}

function connectForPassiveTransfer(host: string, port: number, ftp: FTPContext): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleConnErr = function(err: Error) {
            reject("Can't open data connection in passive mode: " + err.message)
        }
        let socket = new Socket()
        socket.on("error", handleConnErr)
        socket.connect({ port, host, family: ftp.ipFamily }, () => {
            if (ftp.socket instanceof TLSSocket) {
                socket = connectTLS(Object.assign({}, ftp.tlsOptions, {
                    // Upgrade the existing socket connection.
                    socket,
                    // Reuse the TLS session negotiated earlier when the control connection
                    // was upgraded. Servers expect this because it provides additional
                    // security. If a completely new session would be negotiated, a hacker
                    // could guess the port and connect to the new data connection before we do
                    // by just starting his/her own TLS session.
                    session: ftp.socket.getSession()
                }))
                // It's the responsibility of the transfer task to wait until the
                // TLS socket issued the event 'secureConnect'. We can't do this
                // here because some servers will start upgrading after the
                // specific transfer request has been made. List and download don't
                // have to wait for this event because the server sends whenever it
                // is ready. But for upload this has to be taken into account,
                // see the details in the upload() function below.
            }
            // Let the FTPContext listen to errors from now on, remove local handler.
            socket.removeListener("error", handleConnErr)
            ftp.dataSocket = socket
            resolve()
        })
    })
}

/**
 * Helps resolving/rejecting transfers.
 *
 * This is used internally for all FTP transfers. For example when downloading, the server might confirm
 * with "226 Transfer complete" when in fact the download on the data connection has not finished
 * yet. With all transfers we make sure that a) the result arrived and b) has been confirmed by
 * e.g. the control connection. We just don't know in which order this will happen.
 */
class TransferResolver {

    protected response: FTPResponse | undefined = undefined
    protected dataTransferDone = false

    /**
     * Instantiate a TransferResolver
     */
    constructor(readonly ftp: FTPContext, readonly progress: ProgressTracker) {}

    /**
     * Mark the beginning of a transfer.
     *
     * @param name - Name of the transfer, usually the filename.
     * @param type - Type of transfer, usually "upload" or "download".
     */
    onDataStart(name: string, type: string) {
        // Let the data socket be in charge of tracking timeouts during transfer.
        // The control socket sits idle during this time anyway and might provoke
        // a timeout unnecessarily. The control connection will take care
        // of timeouts again once data transfer is complete or failed.
        if (this.ftp.dataSocket === undefined) {
            throw new Error("Data transfer should start but there is no data connection.")
        }
        this.ftp.socket.setTimeout(0)
        this.ftp.dataSocket.setTimeout(this.ftp.timeout)
        this.progress.start(this.ftp.dataSocket, name, type)
    }

    /**
     * The data connection has finished the transfer.
     */
    onDataDone(task: TaskResolver) {
        this.progress.updateAndStop()
        // Hand-over timeout tracking back to the control connection. It's possible that
        // we don't receive the response over the control connection that the transfer is
        // done. In this case, we want to correctly associate the resulting timeout with
        // the control connection.
        this.ftp.socket.setTimeout(this.ftp.timeout)
        if (this.ftp.dataSocket) {
            this.ftp.dataSocket.setTimeout(0)
        }
        this.dataTransferDone = true
        this.tryResolve(task)
    }

    /**
     * The control connection reports the transfer as finished.
     */
    onControlDone(task: TaskResolver, response: FTPResponse) {
        this.response = response
        this.tryResolve(task)
    }

    /**
     * An error has been reported and the task should be rejected.
     */
    onError(task: TaskResolver, err: Error) {
        this.progress.updateAndStop()
        this.ftp.socket.setTimeout(this.ftp.timeout)
        this.ftp.dataSocket = undefined
        task.reject(err)
    }

    /**
     * Control connection sent an unexpected request requiring a response from our part. We
     * can't provide that (because unknown) and have to close the contrext with an error because
     * the FTP server is now caught up in a state we can't resolve.
     */
    onUnexpectedRequest(response: FTPResponse) {
        const err = new Error(`Unexpected FTP response is requesting an answer: ${response.message}`)
        this.ftp.closeWithError(err)
    }

    protected tryResolve(task: TaskResolver) {
        // To resolve, we need both control and data connection to report that the transfer is done.
        const canResolve = this.dataTransferDone && this.response !== undefined
        if (canResolve) {
            this.ftp.dataSocket = undefined
            task.resolve(this.response)
        }
    }
}

/**
 * Upload stream data as a file. For example:
 *
 * `upload(ftp, fs.createReadStream(localFilePath), remoteFilename)`
 */
function upload(ftp: FTPContext, progress: ProgressTracker, source: Readable, remoteFilename: string): Promise<FTPResponse> {
    const resolver = new TransferResolver(ftp, progress)
    const command = "STOR " + remoteFilename
    return ftp.handle(command, (res, task) => {
        if (res instanceof Error) {
            resolver.onError(task, res)
        }
        else if (res.code === 150 || res.code === 125) { // Ready to upload
            const dataSocket = ftp.dataSocket
            if (!dataSocket) {
                resolver.onError(task, new Error("Upload should begin but no data connection is available."))
                return
            }
            // If we are using TLS, we have to wait until the dataSocket issued
            // 'secureConnect'. If this hasn't happened yet, getCipher() returns undefined.
            const canUpload = "getCipher" in dataSocket ? dataSocket.getCipher() !== undefined : true
            onConditionOrEvent(canUpload, dataSocket, "secureConnect", () => {
                ftp.log(`Uploading to ${describeAddress(dataSocket)} (${describeTLS(dataSocket)})`)
                resolver.onDataStart(remoteFilename, "upload")
                source.pipe(dataSocket).once("finish", () => {
                    dataSocket.destroy() // Explicitly close/destroy the socket to signal the end.
                    resolver.onDataDone(task)
                })
            })
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.onControlDone(task, res)
        }
        else if (positiveIntermediate(res.code)) {
            resolver.onUnexpectedRequest(res)
        }
        // Ignore all other positive preliminary response codes (< 200)
    })
}

/**
 * Download data from the data connection. Used for downloading files and directory listings.
 */
function download(ftp: FTPContext, progress: ProgressTracker, destination: Writable, command: string, remoteFilename = ""): Promise<FTPResponse> {
    if (!ftp.dataSocket) {
        throw new Error("Download will be initiated but no data connection is available.")
    }
    // It's possible that data transmission begins before the control socket
    // receives the announcement. Start listening for data immediately.
    ftp.dataSocket.pipe(destination)
    const resolver = new TransferResolver(ftp, progress)
    return ftp.handle(command, (res, task) => {
        if (res instanceof Error) {
            resolver.onError(task, res)
        }
        else if (res.code === 150 || res.code === 125) { // Ready to download
            const dataSocket = ftp.dataSocket
            if (!dataSocket) {
                resolver.onError(task, new Error("Download should begin but no data connection is available."))
                return
            }
            ftp.log(`Downloading from ${describeAddress(dataSocket)} (${describeTLS(dataSocket)})`)
            resolver.onDataStart(remoteFilename, "download")
            // Confirm the transfer as soon as the data socket transmission ended.
            // It's possible, though, that the data transmission is complete before
            // the control socket receives the accouncement that it will begin.
            // Check if the data socket is not already closed.
            onConditionOrEvent(dataSocket.destroyed, dataSocket, "end", () => resolver.onDataDone(task))
        }
        else if (res.code === 350) { // Restarting at startAt.
            ftp.send("RETR " + remoteFilename)
        }
        else if (positiveCompletion(res.code)) { // Transfer complete
            resolver.onControlDone(task, res)
        }
        else if (positiveIntermediate(res.code)) {
            resolver.onUnexpectedRequest(res)
        }
        // Ignore all other positive preliminary response codes (< 200)
    })
}

/**
 * Calls a function immediately if a condition is met or subscribes to an event and calls
 * it once the event is emitted.
 *
 * @param condition  The condition to test.
 * @param emitter  The emitter to use if the condition is not met.
 * @param eventName  The event to subscribe to if the condition is not met.
 * @param action  The function to call.
 */
function onConditionOrEvent(condition: boolean, emitter: EventEmitter, eventName: string, action: () => any) {
    if (condition === true) {
        action()
    }
    else {
        emitter.once(eventName, () => action())
    }
}

/**
 * Upload the contents of a local directory to the working directory. This will overwrite
 * existing files and reuse existing directories.
 */
async function uploadDirContents(client: Client, localDirPath: string): Promise<void> {
    const files = await fsReadDir(localDirPath)
    for (const file of files) {
        const fullPath = join(localDirPath, file)
        const stats = await fsStat(fullPath)
        if (stats.isFile()) {
            await client.upload(createReadStream(fullPath), file)
        }
        else if (stats.isDirectory()) {
            await openDir(client, file)
            await uploadDirContents(client, fullPath)
            await client.send("CDUP")
        }
    }
}

/**
 * Try to create a directory and enter it. This will not raise an exception if the directory
 * couldn't be created if for example it already exists.
 */
async function openDir(client: Client, dirName: string) {
    await client.send("MKD " + dirName, true) // Ignore FTP error codes
    await client.cd(dirName)
}

async function ensureLocalDirectory(path: string) {
    try {
        await fsStat(path)
    }
    catch(err) {
        await fsMkDir(path)
    }
}
