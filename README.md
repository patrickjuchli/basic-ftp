# Basic FTP

[![Build Status](https://travis-ci.org/patrickjuchli/basic-ftp.svg?branch=master)](https://travis-ci.org/patrickjuchli/basic-ftp) [![npm version](https://img.shields.io/npm/v/basic-ftp.svg)](https://www.npmjs.com/package/basic-ftp)

This is an FTP/FTPS client for NodeJS.

## Goals and non-goals

The main goal is to provide an API that is easy to compose and extend. FTP is an old protocol, there are many features, quirks and server implementations. A server response might not be as expected, a directory listing might use yet another format as there is no standard for it.

This library does not try to solve all these issues. The goal is to provide a solid foundation and a simple extension pattern for you to solve your specific issues without requiring a change in the library itself.

Non-goals are: Feature completeness, support for every FTP server, complete abstraction from FTP details. If you're not interested in how FTP works at all, this library might not be for you.

## Dependencies

Node 7.6 or later is the only dependency.

## Examples

The example below shows how to connect, upgrade to TLS, login, get a directory listing and upload a file.

```
const ftp = require("basic-ftp");

async function example() {
    const client = new ftp.Client();
    client.verbose = true;
    try {
        await ftp.connect(client, "192.168.0.10", 21);
        await ftp.useTLS(client);
        await ftp.login(client, "very", "password");
        await ftp.useDefaultSettings(client);
        await ftp.enterPassiveMode(client);
        const list = await ftp.list(client);
        console.log(list);
        await ftp.enterPassiveMode(client);
        await ftp.upload(client, fs.createReadStream("README.md"), "README.md");
    }
    catch(err) {
        console.log(err);
    }
    client.close();
}

example();
```

The `Client` instance holds state shared by all tasks. Specific tasks are then implemented by functions defined anywhere else that use a client instance. The library is designed that way to make it easier to extend functionality: There is no difference between functions already provided and the ones you can add yourself. See the section on extending the library below.

If you're thinking that the example could be written with fewer lines, you're right! I bet you already have an idea how this would look like. Go ahead and write some convenience wrappers however you see fit.

Note the verbosity setting for the client. Enabling it will log out every communication detail, making it easier to spot an issue and address it. It's also great to learn about FTP.

The next example removes all files and directories of the current working directory recursively. It demonstrates how simple it is to write (and read) more complex operations.

```
async function cleanDir(client) {
    await enterPassiveMode(client);
    const files = await list(client);
    for (const file of files) {
        if (file.isDirectory) {
            await send(client, "CWD " + file.name);
            await cleanDir(client);
            await send(client, "CDUP");
            await send(client, "RMD " + file.name);
        }
        else {
            await send(client, "DELE " + file.name);
        }
    }
}
```

## Basic API

`const client = new Client(timeout = 0)`

Create a client instance using an optional timeout in milliseconds that will be used for control and data connections. When you're done with a client, you should call `client.close()`. For everything else you won't use the client directly but the functions listed below.

`connect(client, host, port)`

Connects to an FTP server using a client.

`send(client, command, ignoreErrorCodes = false)`

Send an FTP command. You can optionally choose to ignore error return codes.

`useTLS(client, options)`

Upgrade the existing control connection with TLS. You may provide options that are the same you'd use for `tls.connect()` in NodeJS. There, you may for example set `rejectUnauthorized: false` if you must. Call this function before you log in. Subsequently created data connections with `enterPassiveMode` will automatically be upgraded to TLS.

`enterPassiveMode(client, parseResponse = parseIP4VPasvResponse)`

FTP uses a dedicated socket connection for each single data transfer. Data transfers include directory listings, file uploads and downloads. This means you have to call this function before each call to `list`, `upload` or `download`. You may optionally provide a custom parser for the PASV response.

`list(client, parseResponse = parseUnixList)`

List files and directories in the current working directory. You may optionally provide a custom parser to parse the listing data, for example to support the DOS format. This library only supports the Unix format for now. Parsing these list responses can be regarded as the central piece of every FTP client because there is no standard that all servers adhere to. It is here where libraries spend their lines-of-code and it might be here where you run into problems.

`upload(client, readableStream, remoteFilename)`

Upload data from a readable stream and store it as a file with a given filename in the current working directory.

`download(client, writableStream, remoteFilename, startAt = 0)`

Download a file with a given filename from the current working directory and pipe its data to a writable stream. You may optionally start at a specific offset, for example to resume a cancelled transfer.

## Convenience API

The following functions could've been written by you using the Basic API above. They're part of the library because they are convenient shortcuts for frequent tasks.

`login(client, user, password)`

Login with a username and a password.

`useDefaultSettings(client)`

Sends FTP commands to use binary mode (`TYPE I`) and file structure (`STRU F`). If TLS is enabled it will also send `PBSZ 0` and `PROT P`. This should be called after upgrading to TLS and logging in.

`cd(client, remotePath)`

Changes the working directory.

`pwd(client)`

Returns the current working directory.

## Extending the library

For most tasks you'll write custom functions using the Basic API. The Convenience API provides some examples how to do that. It can happen that the Basic API is not enough, though, and you need to go one level lower. The following section describes how you can do that.

### Design

The library consists of 2 parts.

1. A small class `Client` holds state common to all tasks, namely the control and current data socket. It also offers some API for the functions described in the next part and simplifies response and event handling.
2. Asynchronous functions that use the client above as a resource. All functions described in the API section above are implemented using this pattern. If you're missing some functionality or want to simplify a workflow, you will write the same kind of function and never change or extend `Client` itself.

### Example

This is how uploading a file is implemented in the library. Your own custom functions should follow the same pattern. The example assumes that a `dataSocket` on the client is ready, for example by using `enterPassiveMode`.

```
function upload(client, readableStream, remoteFilename) {
    const command = "STOR " + remoteFilename;
    return client.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to upload
            readableStream.pipe(client.dataSocket)
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve();
        }
        else if (res.code > 400 || res.error) {
            task.reject(res);
        }
    });
}
```

This function represents an asynchronously executed task. It uses a method offered by the client: `handle(command, callback)`. This will send a command to the FTP server and register a callback that is in charge for handling all responses from now on. The callback function might be called several times as in the example above. Error and timeout events from both the control and data socket will be rerouted through this callback as well. Also, `client.handle` returns a `Promise` that is created for you and which the upload function then returns as well. That is why the function `upload` can now be used with async/await. The promise is resolved or rejected when you call `resolve` or `reject` on the `task` reference passed to you as a callback argument. The callback function will not be called anymore after resolving or rejecting the task.

To see more examples have a look at this library's source code. All FTP operations are implemented the same way as the example above.

### Client Extension API

When writing these custom functions you will use some methods the `Client` provides.

`get/set socket`

Get or set the socket for the control connection.

`get/set dataSocket`

Get or set the socket for the data connection.

`send(command)`

Send an FTP command.

`handle(command, handler)`

Send an FTP command and register a callback to handle all subsequent responses until the task is rejected or resolved. `command` may be undefined.

`log(message)`

Log a message if the client is set to be `verbose`.
