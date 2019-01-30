/**
 * typescript - 3.2.4
 * node 8.9.0
 */

/// <reference types="node"/>
import * as tls from 'tls';
import * as net from 'net';
import * as stream from 'stream';

type FTPResponse = {
  /**
   * The FTP return code parsed from the FTP return message.
   */
  code: number;
  /**
   * The whole unparsed FTP return message.
   */
  message: string;
};

type AccessOptions = {
  /**
   * Host the client should connect to.
   */
  host?: string;
  /**
   * Port the client should connect to.
   */
  port?: number;
  /**
   * Username to use for login.
   */
  user?: string;
  /**
   * Password to use for login.
   */
  password?: string;
  /**
   * Use explicit FTPS over TLS.
   */
  secure?: boolean;
  /**
   * TLS options as in `tls.connect(options)`
   */
  secureOptions?: tls.ConnectionOptions;
};

type ProgressInfo = {
  /**
   * A name describing this info, e.g. the filename of the transfer.
   */
  name: string;
  /**
   * The type of transfer, typically "upload" or "download".
   */
  type: string;
  /**
   * Transferred bytes in current transfer.
   */
  bytes: number;
  /**
   * Transferred bytes since last counter reset. Useful for tracking multiple transfers.
   */
  bytesOverall: number;
};

type ProgressTrackerHandler = { (info: ProgressInfo): void; };

/**
 * File: 0
 * Directory: 1
 * SymbolicLink: 2
 * Unknown: 3
 */
type FileInfoType = 0 | 1 | 2 | 3;

/**
 * Read: 1
 * Write: 2
 * Execute: 4
 */
type FileInfoPermission = 1 | 2 | 4;

/**
 * Holds information about a remote file.
 */
declare class FileInfo {
  static Type: {
    File: 0,
    Directory: 1,
    SymbolicLink: 2,
    Unknown: 3
  };
  static Permission: {
    Read: 1,
    Write: 2,
    Execute: 4
  };
  name: string;
  type: FileInfoType;
  size: number;
  hardLinkCount: number;
  permissions: {
    user: FileInfoPermission;
    group: FileInfoPermission;
    world: FileInfoPermission;
  };
  link: string;
  group: string;
  user: string;
  date: string;

  constructor(name: string);

  /**
   * Getter
   */
  isFile: boolean;
  /**
   * Getter
   */
  isDirectory: boolean;
  /**
   * Getter
   */
  isSymbolicLink: boolean;
}

type PrepareTransferFunc = (client: Client) => Promise<FTPResponse>;

/**
 * Client offers an API to interact with an FTP server.
 */
export declare class Client {
  ftp: FTPContext;
  prepareTransfer: PrepareTransferFunc;
  parseList: any;
  closed: boolean;

  /**
   * Instantiate an FTP client.
   *
   * @param {number} [timeout=30000]  Timeout in milliseconds, use 0 for no timeout.
   */
  constructor(timeout?: number);
  /**
   * Close the client and all open socket connections.
   *
   * The client can’t be used anymore after calling this method, you have to instantiate a new one to continue any work.
  */
  close(): void;

  /**
   * Connect to an FTP server.
   *
   * @param {string} [host=localhost]  Host the client should connect to.
   * @param {number} [port=21]  Port the client should connect to.
   * @returns {Promise<FTPResponse>}
   */
  connect(host?: string, port?: number): Promise<FTPResponse>;

  /**
   * Send an FTP command.
   *
   * If successful it will return a response object that contains the return code as well
   * as the whole message. Ignore FTP error codes if you don't want an exception to be thrown
   * if an FTP command didn't succeed.
   *
   * @param {string} command  FTP command to send.
   * @param {boolean} [ignoreErrorCodes=false]  Whether to ignore FTP error codes in result.
   * @returns {Promise<FTPResponse>}
   */
  send(command: string, ignoreErrorCodes?: boolean): Promise<FTPResponse>;

  /**
   * Upgrade the current socket connection to TLS.
   *
   * @param {tls.ConnectionOptions} [options={}]  TLS options as in `tls.connect(options)`
   * @param {string} [command="AUTH TLS"]  Set the authentication command, e.g. "AUTH SSL" instead of "AUTH TLS".
   * @returns {Promise<FTPResponse>}
   */
  useTLS(options?: tls.ConnectionOptions, command?: string): Promise<FTPResponse>;

  /**
   * Login a user with a password.
   *
   * @param {string} [user="anonymous"]  Username to use for login.
   * @param {string} [password="guest"]  Password to use for login.
   * @returns {Promise<FTPResponse>}
   */
  login(user?: string, password?: string): Promise<FTPResponse>;

  /**
   * Set the usual default settings.
   *
   * Settings used:
   * * Binary mode (TYPE I)
   * * File structure (STRU F)
   * * Additional settings for FTPS (PBSZ 0, PROT P)
   *
   */
  useDefaultSettings(): Promise<void>;

  /**
   * Convenience method that calls `connect`, `useTLS`, `login` and `useDefaultSettings`.
   *
   * @param {AccessOptions} options
   * @returns {Promise<FTPResponse>} The response after initial connect.
   */
  access(options: AccessOptions): Promise<FTPResponse>;

  /**
   * Set the working directory.
   *
   */
  cd(path: string): Promise<FTPResponse>;

  /**
   * Get the current working directory.
   *
   */
  pwd(): Promise<string>;

  /**
   * Get the last modified time of a file. Not supported by every FTP server, method might throw exception.
   *
   * @param {string} filename  Name of the file in the current working directory.
   * @returns {Promise<Date>}
   */
  lastMod(filename: string): Promise<Date>;

  /**
   * Get a description of supported features.
   *
   * This sends the FEAT command and parses the result into a Map where keys correspond to available commands
   * and values hold further information. Be aware that your FTP servers might not support this
   * command in which case this method will not throw an exception but just return an empty Map.
   *
   * @returns {Promise<Map<string, string>>} a Map, keys hold commands and values further options.
   */
  features(): Promise<Map<string, string>>;

  /**
   * Get the size of a file.
   *
   * @param {string} filename  Name of the file in the current working directory.
   * @returns {Promise<number>}
   */
  size(filename: string): Promise<number>;

  /**
   * Rename a file.
   *
   * Depending on the FTP server this might also be used to move a file from one
   * directory to another by providing full paths.
   *
   * @param {string} path
   * @param {string} newPath
   * @returns {Promise<FTPResponse>} response of second command (RNTO)
   */
  rename(path: string, newPath: string): Promise<FTPResponse>;

  /**
   * Remove a file from the current working directory.
   *
   * You can ignore FTP error return codes which won't throw an exception if e.g.
   * the file doesn't exist.
   *
   * @param {string} filename  Name of the file to remove.
   * @param {boolean} [ignoreErrorCodes=false]  Ignore error return codes.
   * @returns {Promise<FTPResponse>}
   */
  remove(filename: string, ignoreErrorCodes: boolean): Promise<FTPResponse>;

  /**
   * Report transfer progress for any upload or download to a given handler.
   *
   * This will also reset the overall transfer counter that can be used for multiple transfers. You can
   * also pass `undefined` as a handler to stop reporting to an earlier one.
   *
   * @param {ProgressTrackerHandler} [handler=undefined]  Handler function to call on transfer progress.
   */
  trackProgress(handler?: ProgressTrackerHandler): void;

  /**
   * Upload data from a readable stream and store it as a file with a given filename in the current working directory.
   *
   * @param {stream.Readable} readableStream  The stream to read from.
   * @param {string} remoteFilename  The filename of the remote file to write to.
   * @returns {Promise<FTPResponse>}
   */
  upload(readableStream: stream.Readable, remoteFilename: string): Promise<FTPResponse>;

  /**
   * Download a file with a given filename from the current working directory
   * and pipe its data to a writable stream. You may optionally start at a specific
   * offset, for example to resume a cancelled transfer.
   *
   * @param {stream.Writable} writableStream  The stream to write to.
   * @param {string} remoteFilename  The name of the remote file to read from.
   * @param {number} [startAt=0]  The offset to start at.
   * @returns {Promise<FTPResponse>}
   */
  download(writableStream: stream.Writable, remoteFilename: string, startAt?: number): Promise<FTPResponse>;

  /**
   * List files and directories in the current working directory.
   *
   */
  list(): Promise<FileInfo[]>;

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
  removeDir(remoteDirPath: string): Promise<void>;

  /**
   * Remove all files and directories in the working directory without removing
   * the working directory itself.
   *
   * @returns {Promise<void>}
   */
  clearWorkingDir(): Promise<void>;

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
  uploadDir(localDirPath: string, remoteDirName?: string): Promise<void>;

  /**
   * Download all files and directories of the working directory to a local directory.
   *
   * @param {string} localDirPath  The local directory to download to.
   * @returns {Promise<void>}
   */
  downloadDir(localDirPath: string): Promise<void>;

  /**
   * Make sure a given remote path exists, creating all directories as necessary.
   * This function also changes the current working directory to the given path.
   *
   * @param {string} remoteDirPath
   * @returns {Promise<void>}
   */
  ensureDir(remoteDirPath: string): Promise<void>;
}

type TaskResolver = {
  resolve: (...args: any[]) => void;
  reject: (err: Error) => void;
}

type ResponseHandler = (response: Error | FTPResponse, task: TaskResolver) => void;

/**
 * FTPContext holds the control and data sockets of an FTP connection and provides a
 * simplified way to interact with an FTP server, handle responses, errors and timeouts.
 *
 * It doesn't implement or use any FTP commands. It's only a foundation to make writing an FTP
 * client as easy as possible. You won't usually instantiate this, but use `Client`.
 */
export declare class FTPContext {
  /**
   * Options for TLS connections.
   */
  tlsOptions: tls.ConnectionOptions;
  /**
   * IP version to prefer (4: IPv4, 6: IPv6).
   */
  ipFamily?: number;
  /**
   * Log every communication detail.
   */
  verbose: boolean;

  socket: tls.TLSSocket;
  closed: boolean;
  dataSocket?: tls.TLSSocket;
  timeout: number;
  encoding: string;

  /**
   * Instantiate an FTP context.
   *
   * @param {number} [timeout=0] - Timeout in milliseconds to apply to control and data connections. Use 0 for no timeout.
   * @param {string} [encoding="utf8"] - Encoding to use for control connection. UTF-8 by default. Use "latin1" for older servers.
   */
  constructor(timeout?: number, encoding?: string);

  /**
   * Close the context.
   *
   * The context can’t be used anymore after calling this method.
   */
  close(): void;

  /**
   * Send an FTP command without waiting for or handling the result.
   */
  send(command: string): void;

  /**
   * Log message if set to be verbose.
   */
  log(message: string): void;

  /**
   * Return true if the control socket is using TLS. This does not mean that a session
   * has already been negotiated.
   */
  hasTLS: boolean;

  /**
   * Send an FTP command and handle any response until the new task is resolved. This returns a Promise that
   * will hold whatever the handler passed on when resolving/rejecting its task.
   */
  handle(command: string | undefined, responseHandler: ResponseHandler): Promise<any>;
}

/**
 * Describes an FTP server error response including the FTP response code.
 */
export declare class FTPError extends Error {
  name: string;
  code: number;
  constructor(response: FTPResponse);
}

export declare const utils: {
  upgradeSocket: (socket: net.Socket, options: tls.ConnectionOptions) => Promise<tls.TLSSocket>;
  parseIPv4PasvResponse: (message: string) => { host: string; port: number; };
  parseIPv6PasvResponse: (message: string) => number;
};
