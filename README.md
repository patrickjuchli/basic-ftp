# Basic FTP

[![Build Status](https://travis-ci.org/patrickjuchli/basic-ftp.svg?branch=master)](https://travis-ci.org/patrickjuchli/basic-ftp) [![npm version](https://img.shields.io/npm/v/basic-ftp.svg)](https://www.npmjs.com/package/basic-ftp)

This is an FTP/FTPS client for NodeJS.

## Goals and non-goals

This library has two goals: Provide a solid foundation that covers the usual needs and make it easy to extend functionality if necessary.

FTP is an old protocol, there are many features, quirks and server implementations. It's not a goal to support all of them but it should be easy for you to solve your specific issues without changing the library.

## Dependencies

Node 7.6 or later is the only dependency.

## Introduction

`Client` provides a convenience API to interact with an FTP server. The following example shows how to connect, upgrade to TLS, login, get a directory listing and upload a file.

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

The example sets the client to be `verbose`. This will log out all communication, making it easier to spot an issue and address it. It's also a great way to learn about FTP. Why the setting is behind a property `.ftp` will be answered in the section about extending the library below.

Here is another example to show how to compose more complex operations like recursively removing all files and directories. It also shows that not all FTP commands are backed by a method. A similar function is already part of the Client API.

```js
async clearWorkingDir(client) {
    for (const file of await client.list()) {
        if (file.isDirectory) {
            await client.cd(file.name);
            await clearWorkingDir(client);
            await client.send("CDUP");
            await client.send("RMD " + file.name);
        }
        else {
            await client.send("DELE " + file.name);
        }
    }
}
```

## Client API

`new Client(timeout = 0)`

Create a client instance using an optional timeout in milliseconds that will be used for control and data connections.

`close()`

Close all socket connections. The client can't be used anymore after calling this method.

`connect(host, port = 21)`

Connect to an FTP server.

`useTLS([options])`

Upgrade the existing control connection with TLS. You may provide options that are the same you'd use for `tls.connect()` in NodeJS. For example `rejectUnauthorized: false` if you must. Call this function before you log in. Subsequently created data connections will automatically be upgraded to TLS.

`login(user = "anonymous", password = "guest")`

Login with a username and a password.

`useDefaultSettings(client)`

Sends FTP commands to use binary mode (TYPE I) and file structure (STRU F). If TLS is enabled it will also send PBSZ 0 and PROT P. This should be called after upgrading to TLS and logging in.

`send(command, ignoreErrorCodes = false)`

Send an FTP command. You can optionally choose to ignore error return codes. Other errors originating from the socket connections including timeouts will still throw an exception.

`cd(remotePath)`

Change the working directory.

`pwd()`

Get the path of the current working directory.

`features()`

Get a description of supported features. This will return a Map where keys correspond to FTP commands and values contain further details.

`list()`

List files and directories in the current working directory.

`upload(readableStream, remoteFilename)`

Upload data from a readable stream and store it as a file with a given filename in the current working directory.

`download(writableStream, remoteFilename, startAt = 0)`

Download a file with a given filename from the current working directory and pipe its data to a writable stream. You may optionally start at a specific offset, for example to resume a cancelled transfer.

`clearWorkingDir()`

Remove all files and directories from the working directory.

`removeDir(remoteDirPath)`

Remove all files and directories from a given directory, including the directory itself.

`uploadDir(localDirPath, [remoteDirName])`

Upload all files and directories of a local directory to the current working directory. If you specify a `remoteDirName` it will place the uploads inside a directory of the given name.

`downloadDir(localDirPath)`

Download all files and directories of the current working directory to a given local directory.

`ensureDir(remoteDirPath)`

Make sure that the given `remoteDirPath` exists on the server, creating all directories as necessary.

## Customize

`get/set client.prepareTransfer` 

You can provide a custom function that prepares the data connection for a transfer. FTP uses a dedicated socket connection for each single data transfer. Data transfers include directory listings, file uploads and downloads. This property holds the function that prepares this connection. Right now the library only offers Passive Mode over IPv4. The signature of the function is `(ftp: FTPContext) => Promise<void>`. The section below about extending functionality explains what `FTPContext` is.

`get/set client.parseList`

You can provide a custom parser to parse directory listing data, for example to support the DOS format. This library only supports the Unix format for now. Parsing these list responses is a central part of every FTP client because there is no standard that all servers adhere to. The signature of the function is `(rawList: string) => FileInfo[]`. `FileInfo` is also exported by the library.

## Extend

You can use `client.send` to send any FTP command and get its result. This might not be good enough, though. FTP can return multiple responses after a command and a simple command-response pattern won't work. You might also want to have access to sockets.

The client described above is just a collection of convenience functions using an underlying `FTPContext`. An FTPContext provides the foundation to write an FTP client. It holds the socket connections and provides an API to handle responses and simplifies event handling. Through `client.ftp` you get access to this context.

### FTPContext API

`get/set verbose`

Set the verbosity level to optionally log out all communication between the client and the server.

`get/set socket`

Get or set the socket for the control connection. When setting a new socket the current one will *not* be closed because you might be just upgrading the control socket. All listeners will be removed, though.

`get/set dataSocket`

Get or set the socket for the data connection. When setting a new socket the current one will be closed and all listeners will be removed.

`get/set encoding`

Get or set the encoding applied to all incoming and outgoing messages of the control connection. This encoding is also used when parsing a list response from a data connection. Possible values are `utf8`, `latin1`, `ascii`. Default is `utf8` because most modern servers support this and some of them don't even list this feature in the response of the FEAT command. You can change this setting at any time.

`handle(command, handler)`

Send an FTP command and register a handler function to handle all subsequent responses and socket events until the task is rejected or resolved. `command` may be undefined. This returns a promise that is resolved/rejected when the task given to the handler is resolved/rejected. This is the central method of this library, see the example below for a more detailed explanation.

`send(command)`

Send an FTP command without waiting for or handling the response.

`log(message)`

Log a message if the client is set to be `verbose`.

### Example

The best source of examples is the implementation of the `Client` itself as it's using the same single pattern you will use. The code below shows a simplified file upload. Let's assume a transfer connection has already been established.

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
        else if (res.code >= 400 || res.error) {
            task.reject(res);
        }
    });
}

await myUpload(client.ftp, myStream, myName);
```

This function represents an asynchronously executed task. It uses a method offered by the FTPContext: `handle(command, callback)`. This will send a command to the FTP server and register a callback that is in charge for handling all responses from now on. The callback function might be called several times as in the example above. Error and timeout events from both the control and data socket will be rerouted through this callback as well. Also, `client.handle` returns a `Promise` that is created for you and which the upload function above returns. That is why the function `myUpload` can now be used with async/await. The promise is resolved or rejected when you call `resolve` or `reject` on the `task` reference passed to you as a callback argument. The callback function will not be called anymore after resolving or rejecting the task.

