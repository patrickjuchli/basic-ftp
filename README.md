# Basic FTP

[![Build Status](https://travis-ci.org/patrickjuchli/basic-ftp.svg?branch=master)](https://travis-ci.org/patrickjuchli/basic-ftp) [![npm version](https://img.shields.io/npm/v/basic-ftp.svg)](https://www.npmjs.com/package/basic-ftp)

This is an FTP/FTPS client for NodeJS.

## Goals and non-goals

The main goal is to provide an API that is easy to compose and extend. FTP is an old protocol, there are many features, quirks and server implementations. A response might not be as expected, a directory listing use yet another format.

This library does not try to solve all these issues. The goal is to provide a solid foundation and a clean extension pattern for you to solve your specific issues without requiring a change in the library itself.

Non-goals are: Feature completeness, support for every FTP server, complete abstraction from FTP details. If you're not interested in how FTP works at all, this library might not be for you.

## Dependencies

Node 7.6 or later is the only dependency.

## Example

The example below shows how to connect, upgrade to TLS, login, get a directory listing and upload a file.

```js
const ftp = require("basic-ftp");

async function example() {
    const client = new ftp.Client();
    client.ftp.verbose = true;
    try {
        await client.connect("192.168.0.10", 21);
        await client.useTLS();
        await client.login("very", "password");
        await client.useDefaultSettings();
        console.log(await client.list());
        await client.upload(fs.createReadStream("README.md"), "README.md");
    }
    catch(err) {
        console.log(err);
    }
    client.close();
}

example();
```

The `Client` provides a minimal API to interact with an FTP server. Not all FTP commands are backed by a method. You're expected to use most commands directly, using for example `await client.send("CDUP")`.

The example also sets the client to be `verbose`. This will log out every communication detail, making it easier to spot an issue and address it. It's also a great way to learn about FTP. Why is the setting behind a property `.ftp`? This will be answered in the section about extending the library below.

## Client API

`new Client(timeout = 0)`

Create a client instance using an optional timeout in milliseconds that will be used for control and data connections.

`close()`

Close all socket connections. The client can't be used anymore after calling this method.

`connect(host, port)`

Connect to an FTP server.

`useTLS(options)`

Upgrade the existing control connection with TLS. You may provide options that are the same you'd use for `tls.connect()` in NodeJS. There, you may for example set `rejectUnauthorized: false` if you must. Call this function before you log in. Subsequently created data connections will automatically be upgraded to TLS.

`login(user, password)`

Login with a username and a password.

`useDefaultSettings(client)`

Sends FTP commands to use binary mode (`TYPE I`) and file structure (`STRU F`). If TLS is enabled it will also send `PBSZ 0` and `PROT P`. This should be called after upgrading to TLS and logging in.

`send(command, ignoreErrorCodes = false)`

Send an FTP command. You can optionally choose to ignore error return codes.

`cd(remotePath)`

Changes the working directory.

`pwd()`

Returns the path of the current working directory.

`list()`

List files and directories in the current working directory.

`upload(readableStream, remoteFilename)`

Upload data from a readable stream and store it as a file with a given filename in the current working directory.

`download(writableStream, remoteFilename, startAt = 0)`

Download a file with a given filename from the current working directory and pipe its data to a writable stream. You may optionally start at a specific offset, for example to resume a cancelled transfer.

`removeDir(remoteDirPath)`

Removes a directory at a given path, including all of its files and directories.

`clearWorkingDir()`

Removes all files and directories from the working directory.

`uploadDir(localDirPath, remoteDirName = undefined)`

Uploads all files and directories of a local directory to the current working directory. If you specify a `remoteDirName` it will place the uploads inside a directory of the given name.

`downloadDir(localDirPath)`

Downloads all files and directories of the current working directory to a given local directory.

`ensureDir(remoteDirPath)`

Makes sure that the given `remoteDirPath` exists on the server, creating all directories as necessary.

## Customize

`get/set client.prepareTransfer` 

FTP uses a dedicated socket connection for each single data transfer. Data transfers include directory listings, file uploads and downloads. This property holds the function that prepares this connection. Right now the library only offers Passive Mode over IPv4. The signature of the function is `(ftp: FTPContext) => Promise<void>`. The section below about extending functionality explains what `FTPContext` is.

`get/set client.parseList`

You may optionally provide a custom parser to parse the listing data, for example to support the DOS format. This library only supports the Unix format for now. Parsing these list responses can be regarded as the central piece of every FTP client because there is no standard that all servers adhere to. The signature of the function is `(rawList: string) => FileInfo[]`. `FileInfo` is also exported by the library.

## Extend

For most tasks you can use `client.send` to send any FTP command and get its result. This might not be good enough, though. FTP can return multiple responses after a command, so a simple command-response pattern doesn't always work. You might also want to have access to sockets.

The client is just a collection of convenience functions using an underlying `FTPContext`. An FTPContext provides the foundation to write an FTP client. It holds the socket connections and provides a pattern to handle responses and simplifies event handling. Through `client.ftp` you get access to this context.

### FTPContext API

`get/set verbose`

Set the verbosity level to optionally log out all communication between the client and the server.

`get/set socket`

Get or set the socket for the control connection.

`get/set dataSocket`

Get or set the socket for the data connection.

`handle(command, handler)`

Send an FTP command and register a callback to handle all subsequent responses, error and timeout events until the task is rejected or resolved. `command` may be undefined. This returns a promise that is resolved/rejected when the task given to the handler is resolved/rejected. (See example below).

`send(command)`

Send an FTP command without waiting for or handling the response.

`log(message)`

Log a message if the client is set to be `verbose`.

### Example

The best source of examples is the implementation of the `Client` itself as it's using the same patterns you will use. The code below shows a custom file upload. Let's assume a transfer connection has already been established.

```js
function myUpload(ftp, readableStream, remoteFilename) {
    const command = "STOR " + remoteFilename;
    return ftp.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to upload
            readableStream.pipe(ftp.dataSocket)
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve(res);
        }
        else if (res.code > 400 || res.error) {
            task.reject(res);
        }
    });
}

await myUpload(client.ftp, myStream, myName);
```

This function represents an asynchronously executed task. It uses a method offered by the FTPContext: `handle(command, callback)`. This will send a command to the FTP server and register a callback that is in charge for handling all responses from now on. The callback function might be called several times as in the example above. Error and timeout events from both the control and data socket will be rerouted through this callback as well. Also, `client.handle` returns a `Promise` that is created for you and which the upload function above returns. That is why the function `myUpload` can now be used with async/await. The promise is resolved or rejected when you call `resolve` or `reject` on the `task` reference passed to you as a callback argument. The callback function will not be called anymore after resolving or rejecting the task.

