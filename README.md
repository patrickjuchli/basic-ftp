# Basic FTP

[![Build Status](https://travis-ci.org/patrickjuchli/basic-ftp.svg?branch=master)](https://travis-ci.org/patrickjuchli/basic-ftp) [![npm version](https://img.shields.io/npm/v/basic-ftp.svg)](https://www.npmjs.com/package/basic-ftp)

This is an FTP client for Node.js. It supports explicit FTPS over TLS, Passive Mode over IPv6, has a Promise-based API, and offers methods to operate on whole directories.

## Advisory

Prefer alternative transfer protocols like HTTPS or SFTP (SSH). Use this library when you have no choice and need to use FTP. Try to use FTPS whenever possible, FTP alone does not provide any security.

## Dependencies

Node 8.0 or later is the only dependency.

## Introduction

The first example will connect to an FTP server using TLS, get a directory listing, and upload a file. Note that the FTP protocol doesn't allow multiple requests running in parallel.

```js
const ftp = require("basic-ftp")
const fs = require("fs")

example()

async function example() {
    const client = new ftp.Client()
    client.ftp.verbose = true
    try {
        await client.access({
            host: "myftpserver.com",
            user: "very",
            password: "password",
            secure: true
        })
        console.log(await client.list())
        await client.upload(fs.createReadStream("README.md"), "README.md")
    }
    catch(err) {
        console.log(err)
    }
    client.close()
}
```

The next example deals with directories and their content. First, we make sure a remote path exists, creating all directories as necessary. Then, we make sure it's empty and upload the contents of a local directory.

```js
await client.ensureDir("my/remote/directory")
await client.clearWorkingDir()
await client.uploadDir("my/local/directory")
```

If you encounter a problem, it may help to log out all communication with the FTP server.

```js
client.ftp.verbose = true
```

## Client API

`new Client(timeout = 30000)`

Create a client instance. Configure it with a timeout in milliseconds that will be used for any connection made. Use 0 to disable timeouts, default is 30 seconds.

`close()`

Close the client and any open connection. The client can’t be used anymore after calling this method, you'll have to reconnect with `access` to continue any work. A client is also closed automatically if any timeout or connection error occurs. See the section on [Error Handling](#error-handling) below.

`closed`

True if the client has been closed, either by the user or by an error.

`access(options): Promise<FTPResponse>`

Get access to an FTP server. This method will connect to a server, optionally secure the connection with TLS, login a user and apply some default settings (TYPE I, STRU F, PBSZ 0, PROT P). It returns the response of the initial connect command. This is an instance method and thus can be called multiple times during the lifecycle of a `Client` instance. Whenever you do, the client is reset with a new connection. This also implies that you can reopen a `Client` instance that has been closed due to an error when reconnecting with this method. The available options are:

- `host (string)` Server host, default: localhost
- `port (number)` Server port, default: 21
- `user (string)` Username, default: anonymous
- `password (string)` Password, default: guest
- `secure (boolean)` Explicit FTPS over TLS, default: false
- `secureOptions` Options for TLS, same as for [tls.connect()](https://nodejs.org/api/tls.html#tls_tls_connect_options_callback) in Node.js.

---

`features(): Promise<Map<string, string>>`

Get a description of supported features. This will return a Map where keys correspond to FTP commands and values contain further details.

`send(command, ignoreErrorCodes = false): Promise<FTPResponse>`

Send an FTP command. You can choose to ignore error return codes. Other errors originating from a connection including timeouts will still reject the Promise returned.

`cd(remotePath): Promise<FTPResponse>`

Change the working directory.

`pwd(): Promise<string>`

Get the path of the current working directory.

`list([path]): Promise<FileInfo[]>`

List files and directories in the current working directory, or from `path` if specified. Currently, this library only supports Unix- and DOS-style directory listings. See [FileInfo](src/FileInfo.ts) for more details.

`lastMod(filename): Promise<Date>`

Get the last modification time of a file in the working directory. This command might not be supported by your FTP server and throw an exception.

`size(filename): Promise<number>`

Get the size of a file in the working directory.

`rename(path, newPath): Promise<FTPResponse>`

Rename a file. Depending on the server you may also use this to move a file to another directory by providing full paths.

`remove(filename, ignoreErrorCodes = false): Promise<FTPResponse>`

Remove a file from the working directory.

`upload(readableStream, remoteFilename): Promise<FTPResponse>`

Upload data from a readable stream and store it as a file with a given filename in the current working directory. If such a file already exists it will be overwritten.

`append(readableStream, remoteFilename): Promise<FTPResponse>`

Upload data from a readable stream and append it to an existing file with a given filename in the current working directory. If the file doesn't exist the FTP server should create it.

`download(writableStream, remoteFilename, startAt = 0): Promise<FTPResponse>`

Download a file with a given filename from the current working directory and pipe its data to a writable stream. You may optionally start at a specific offset, for example to resume a cancelled transfer.

---

`ensureDir(remoteDirPath): Promise<void>`

Make sure that the given `remoteDirPath` exists on the server, creating all directories as necessary. The working directory is at `remoteDirPath` after calling this method.

`clearWorkingDir(): Promise<void>`

Remove all files and directories from the working directory.

`removeDir(remoteDirPath): Promise<void>`

Remove all files and directories from a given directory, including the directory itself. When this task is done, the working directory will be the parent directory of `remoteDirPath`.

`uploadDir(localDirPath, [remoteDirName]): Promise<void>`

Upload all files and directories of a local directory to the current working directory. If you specify a `remoteDirName` it will place the uploads inside a directory of the given name. This will overwrite existing files with the same names and reuse existing directories. Unrelated files and directories will remain untouched.

`downloadDir(localDirPath): Promise<void>`

Download all files and directories of the current working directory to a given local directory.

---

`trackProgress(handler)`

Report any transfer progress using the given handler function. See the next section for more details.

## Transfer Progress

Set a callback function with `client.trackProgress` to track the progress of all uploads and downloads. To disable progress reporting, call `trackProgress` with an undefined handler.

```js
// Log progress for any transfer from now on.
client.trackProgress(info => {
    console.log("File", info.name)
    console.log("Type", info.type)
    console.log("Transferred", info.bytes)
    console.log("Transferred Overall", info.bytesOverall)
})

// Transfer some data
await client.upload(someStream, "test.txt")
await client.upload(someOtherStream, "test2.txt")

// Set a new callback function which also resets the overall counter
client.trackProgress(info => console.log(info.bytesOverall))
await client.downloadDir("local/path")

// Stop logging
client.trackProgress()
```

For each transfer, the callback function will receive the filename, transfer type (upload/download) and number of bytes transferred. The function will be called at a regular interval during a transfer.

There is also a counter for all bytes transferred since the last time `trackProgress` was called. This is useful when downloading a directory with multiple files where you want to show the total bytes downloaded so far.

## Error Handling

Any error reported by the FTP server will be thrown as `FTPError`. The connection to the FTP server stays intact and you can continue to use your `Client` instance.

This is different with a timeout or connection error: In addition to an `Error` being thrown, any connection to the FTP server will be closed. You’ll have to reconnect with `client.access()`, if you want to continue any work.

## Logging

Using `client.ftp.verbose = true` will log debug-level information to the console. You can use your own logging library by overriding `client.ftp.log`. This method is called regardless of what `client.ftp.verbose` is set to. For example:

```
myClient.ftp.log = myLogger.debug
```

## Static Types

In addition to unit tests and linting, the source code is written in Typescript using rigorous [compiler settings](tsconfig.json) like `strict` and `noImplicitAny`. When building the project, the source is transpiled to Javascript and type declaration files. This makes the library useable for both Javascript and Typescript projects.

## Extending the library

### Custom strategies

`get/set client.prepareTransfer`

Provide a function that initializes a data connection. FTP uses a dedicated socket connection for each file upload, download and directory listing. This library supports two strategies: Passive Mode over IPv4 (PASV) and IPv6 (EPSV). Active Mode is not supported but could be added using this extension point. The signature of the function is `(client: Client) => Promise<void>` and its job is to set `client.ftp.dataSocket`.

`get/set client.parseList`

Provide a function to parse directory listing data. This library supports Unix and DOS formats. Parsing these list responses is one of the more challenging parts of FTP because there is no standard that all servers adhere to. The signature of the function is `(rawList: string) => FileInfo[]`.

### FTPContext

The Client API described so far is implemented using an FTPContext. An FTPContext provides the foundation to write an FTP client. It holds the socket connections and provides an API to handle responses and events in a simplified way. Through `client.ftp` you get access to this context.

`get/set verbose`

Set the verbosity level to optionally log out all communication between the client and the server.

`get/set encoding`

Set the encoding applied to all incoming and outgoing messages of the control connection. This encoding is also used when parsing a list response from a data connection. Node supports `utf8`, `latin1` and `ascii`. Default is `utf8` because it's backwards-compatible with `ascii` and many modern servers support it, some of them without mentioning it when requesting features.

`get/set ipFamily`

Set the preferred version of the IP stack: `4` (IPv4), `6` (IPv6) or `undefined` (Node.js default). Set to `undefined` by default.

`get/set socket`

Set the socket for the control connection. This will only close the current control socket if the new one is not a TLS upgrade to the current one.

`get/set dataSocket`

Set the socket for the data connection. When setting a new socket the current one will be closed and all listeners will be removed.

`handle(command, handler): Promise<FTPResponse>`

Send an FTP command and register a handler function to handle all subsequent responses and socket events until the task is rejected or resolved. `command` may be undefined. This returns a promise that is resolved/rejected when the task given to the handler is resolved/rejected. This is the central method of this library, see the example below for a more detailed explanation.

`send(command)`

Send an FTP command without waiting for or handling the response.

`log(message)`

Log a message if the client is set to be `verbose`.

### Using FTPContext

The best source of examples is the implementation of the `Client` itself as it's using the same single pattern you will use. The code below shows a simplified file upload. Let's assume a transfer connection has already been established.

```js
function mySimpleUpload(ftp, readableStream, remoteFilename) {
    const command = "STOR " + remoteFilename
    return ftp.handle(command, (res, task) => {
        if (res instanceof Error) {
            task.reject(res)
        }
        else if (res.code === 150) { // Ready to upload
            readableStream.pipe(ftp.dataSocket)
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve(res)
        }
    })
}

await mySimpleUpload(client.ftp, myStream, myName)
```

This function represents an asynchronously executed task. It uses a method offered by the FTPContext: `handle(command, callback)`. This will send a command to the FTP server and register a callback that is in charge for handling all responses from now on. The callback function might be called several times as in the example above. Error and timeout events from both the control and data socket will be rerouted through this callback as well. Also, `client.handle` returns a `Promise` that is created for you and which the upload function above returns. That is why the function `myUpload` can now be used with async/await. The promise is resolved or rejected when you call `resolve` or `reject` on the `task` reference passed to you as a callback argument. The callback function will not be called anymore after resolving or rejecting the task.

## Acknowledgment

This library uses parts of the [directory listing parsers](https://github.com/apache/commons-net/tree/master/src/main/java/org/apache/commons/net/ftp/parser) written by The Apache Software Foundation. They've been made available under the Apache 2.0 license. See the [included notice](NOTICE.txt) and headers in the respective files containing the original copyright texts and a description of changes.