# Changelog


## 4.5.3

- Fixed: Allow 'undefined' to be passed to trackProgress. (#125, @FabianMeul)

## 4.5.2

- Fixed: Try next available list command after any FTP error. (#117)

## 4.5.1

- Fixed: Remove eager check for `remoteAddress` of a socket. (#106)

## 4.5.0

- Added: Directory listings are included in transfer progress tracking.
- Fixed: Possible edge case where socket is disconnected but client still says it's open.

## 4.4.1

- Fixed: Return to former working directory also after error when calling directory-related methods.

## 4.4.0

- Changed: Current API `uploadDir` and `downloadDir` has been deprecated, use `uploadFromDir` and `downloadToDir`.
- Added: You can specifiy a custom remote directory with `downloadToDir`.

## 4.3.2

- Fixed regression at 4.3.0: File descriptor closed too early. (#103)

## 4.3.1

- Fixed: When downloading to a local file and an error occurs, only remove it if no data has been downloaded so far.

## 4.3.0

- Added: More explicit API `uploadFrom`, `appendFrom` and `downloadTo`. `upload` and `download` are still available but deprecated.
- Added: Handle file downloads and uploads directly by supporting local file paths in `uploadFrom` and `downloadTo`.
- Added: Make it easier to resume a download of a partially downloaded file. See documentation of `downloadTo` for more details.

## 4.2.1

- Fixed: Don't rely on MLSD types 'cdir' and 'pdir'. (#99)

## 4.2.0

- Added: Support uploading a local directory to any specific remote directory instead of just the working directory.

## 4.1.0

- Added: Support symbolic links in MLSD listings.

## 4.0.2

- Fixed: Make MLSD listing detection more general. (#95)
- Fixed: Handle MLSD facts 'sizd', 'UNIX.gid' and 'UNIX.uid'. (#95)

## 4.0.1

- Fixed: Describe client as closed before first connection (#94)

## 4.0.0

This release contains the following **breaking changes**:

- Changed: The `permissions` property of `FileInfo` is now undefined if no Unix permissions are present. This is the case if for example the FTP server does not actually run on Unix. Before, permissions would have been set to 000. If permissions are present there is a good chance that a command like `SITE CHMOD` will work for the current server.
- Changed: MLSD is now the default directory listing command. If the connected server doesn't support it, the library will continue using the LIST command. This might have an impact on reported permissions for a file. It is possible although rare that a server running on Unix would have reported permissions with LIST but doesn't do so with MLSD.
- Changed: If you've been parsing `date` of `FileInfo`, you might have to consider a new ISO format coming with MLSD listings, e.g. `2018-10-25T12:04:59.000Z`. Better yet, use the parsed date directly with `modifiedAt` and only use `date` if it is undefined. Be aware that parsing dates reported by the LIST command is likely unreliable.

Non-breaking changes:

- Added: Support for MLSD directory listing. This is a machine-readable directory listing format that provides modification dates that can be reliably parsed. Listings by the older command LIST have not been designed to be machine-readable and are notoriously hard to parse.
- Added: The property `modifiedAt` of FileInfo may hold a parsed date if the FTP server supports the MLSD command. Note that the property `date` is not parsed but only a human-readable string coming directly from the original listing response.
- Added: New API `sendIgnoringError` to send an FTP command and ignoring a resulting FTP error. Using the boolean flag as the second argument of `send` has been deprecated.
- Added: Sending `OPTS UTF8 ON` when accessing a server.

## 3.8.3 - 3.8.7

No changes, republishing because of bug on npmjs.com.

## 3.8.2

- Fixed: Fall back to `LIST` command if `LIST -a` is not supported. (#91)

## 3.8.1

- Fixed: Support non-standard response to EPSV by IBM i or z/OS servers. (#87)
- Fixed: Make unit tests for failing streams less dependent on platform. (#86)
- Fixed: Improve marking protected methods for JS compilation output.

## 3.8.0

- Added: Use `client.append()` to append to an existing file on the FTP server. (#83)

## 3.7.1

- Fixed: Use ESLint instead of TSLint.

## 3.7.0

- Added: Users can access internal transfer modes to force a specific one. (#77)
- Fixed: Handle stream error events for upload and download.

## 3.6.0

- Added: Make parseList public API. (#75, @xnerhu)
- Changed: Update Typescript 3.5.1

## 3.5.0

- Added: Client `list` method supports optional path argument. (#69, @ThatOdieGuy)
- Changed: Updated Typescript 3.4.4

## 3.4.4

- Fixed: Reject failing connection for passive transfer with Error instance. (#65)

## 3.4.3

- Fixed: Handle multline response message closing without message. (#63)
- Fixed: Track timeout during connect. (#64)

## 3.4.2

- Fixed: Unix directory listing in some cases interpreted as DOS listing. (#61)

## 3.4.1

- Fixed: Close the control connection when `connect` creates a new one.

## 3.4.0

- Changed: `access` and `connect` can reopen a closed `Client`.
- Fixed: `access` can be called again after failed login. (#56)

## 3.3.1

- Fixed: Republish to (maybe) fix NPM issue of wrong stats.

## 3.3.0

- Added: Support for leading whitespace in file and directory names.

## 3.2.2

- Fixed: Make package scripts easier to understand.

## 3.2.1

- Fixed: Republish to (maybe) fix NPM issue of wrong stats.

## 3.2.0

- Changed: Source is now written in Typescript, fixes #49.

## 3.1.1

- Fixed: Switch seamlessly between control and data connection for tracking timeout.

## 3.1.0

- Added: Full type-checking as part of CI with Typescript and JSDoc type declarations. Check is rigourous, settings include 'strict' or 'noImplicitAny'.
- Changed: Improved handling of unexpected server requests during transfer.

## 3.0.0

This release contains the following breaking changes:

- Changed: `Client` is now single-use only. It can't be used anymore once it closes and a new client has to be instantiated.
- Changed: All exceptions are now instances of `Error`, not custom error objects. Introduced `FTPError` for errors specific to FTP. (#37)

Non-breaking changes:

- Added: If there is a socket error outside of a task, the following task will receive it. (#43)
- Changed: Improved feedback if a developer forgets to use `await` or `.then()` for tasks. (#36)

Special thanks to @broofa for feedback and reviews.

## 2.17.1

- Fixed: Multibyte UTF-8 arriving in multiple chunks (#38)
- Fixed: Unit test throws unhandled exception (#44)
- Fixed: Provide stack trace when closing due to multiple tasks running
- Internal improvements to linting (@broofa)

## 2.17.0

- Added: Get last modification time of a file. (#32, @AnsonYeung)

## 2.16.1

- Fixed: Closing client during task will reject associated promise. (#34)

## 2.16.0

- Changed: Include hidden files in file listings, fixes `removeDir` and `clearWorkingDir`. Changes behaviour for `downloadDir` and `list`. (#29, @conlanpatrek)

## 2.15.0

- Changed: Timeout on control socket is only considered during active task, not when idle. This also fixes #27, as well as #26.

## 2.14.4

- Fixed: Regression where closed clients throws timeout because of idle socket. (#26)

## 2.14.3

- Fixed: JSDoc type annotations.
- Fixed: Minor fixes to documentation.

## 2.14.2

- Fixed: Unit test for adjusted behavior when closing context.

## 2.14.1

- Fixed: Make it possible to reconnect after closing the FTP context.

## 2.14.0

- Added: Improved error handling and reporting.

## 2.13.2

- Fixed: Various improvements to documentation.

## 2.13.1

- Fixed: Exception thrown if tasks will run in parallel because the user forget to use 'await'.
- Fixed: Describe in documentation what exactly happens if there is a timeout.

## 2.13.0

- Added: Use client.rename() to rename or move a file.
- Changed: Default timeout set to 30 seconds.
- Changed: Timeouts are tracked exlusively by data connection during transfer.
- Fixed: Node's socket.removeAllListeners() doesn't work, see https://github.com/nodejs/node/issues/20923
- Fixed: Node 8 is required, correct documentation and CI.

## 2.12.3

- Fixed: Minor changes to documentation.

## 2.12.2

- Fixed: Don't deny EPSV over IPv4. This can help in some circumstances with a NAT.

## 2.12.1

- Fixed: Don't prefer IPv6 by default.

## 2.12.0

- Added: Support IPv6 for passive mode (EPSV).
- Added: Detect automatically whether to use EPSV or PASV.
- Added: Log server IP when connected.

## 2.11.0

- Added: Convenience method `client.access` to simplify access to an FTP(S) server.
- Updated API documentation.
- Stop using Yarn for internal dev-dependencies.

## 2.10.0

- Added: Resolve simple NAT issues with PASV.
- Added: Log socket encryption right before login.
- Fixed: Remove obsolete socket connection error listener.

## 2.9.2

- Improved documentation of client methods.
- Fixed: Reason for error when parsing PASV response was not reported.

## 2.9.1

- Mention regression in Node.js negatively affecting upload progress reporting.
- Small fixes in documentation.

## 2.9.0

- Added: Report transfer progress with client.trackProgress().
- Added: Error return codes can be ignored when removing a single file.
- Fixed: Timeout behaviour of control and data socket.

## 2.8.3

- Improve introduction.
- More unit tests.

## 2.8.2

- When downloading, handle incoming data before announcement from control socket arrives.
- More tests for uploading and downloading data including directory listings.
- Use download mechanism for directory listings as well.

## 2.8.1

- Improve documentation.
- Update linter.

## 2.8.0

- Change uploadDir() so that it reuses directories on the FTP server if they already exist. (#5)

## 2.7.1

- Fix linter complaint.

## 2.7.0

- Add method to remove a file.
- Fix listing parser autodetection by filtering out empty lines.
- Fix upload with TLS, wait for secureConnect if necessary.

## 2.6.2

- Fix TLS upgrade for data connections. (#4)

## 2.6.1

- Handle TLS upgrade error by reporting it to the current task handler.

## 2.6.0

- Add method to retrieve file size.

## 2.5.2

- Don't report unexpected positive completion codes as errors.
- Improve documentation.

## 2.5.1

- Mention DOS-style directory listing support in README.

## 2.5.0

- Add support for DOS-style directory listing.
- Select a compatible directory listing parser automatically.
- Throw an exception with a detailed description if the directory listing can't be parsed.

## 2.4.2

- Fix documentation of default arguments for login().

## 2.4.1

- Improve introduction in README

## 2.4.0

- Add default port for connect().
- Add default anonymous credentials for login().
- Improve documentation

## 2.3.3

- Accept more positive preliminary and completion replies for transfers.

## 2.3.2

- Documentation improvements
- More internal functions made available for custom extensions.

## 2.3.1

- Wait for both data and control connection reporting completion for list, upload and download.

## 2.3.0

- Add features() method to client that returns a parsed result of the FEAT command.
- Give access to internal list, upload and download functions for reuse in custom contexts.

## 2.2.1

- Handle case when downloading, a server might report transfer complete when it isn't.
- Document encoding property on FTPContext.

## 2.2.0

- Encoding can be set explicitly, defaults to UTF-8.
- Handle multiline responses arriving in multiple chunks.

## 2.1.0

- Support multiline responses.
- Get user access to some internal utility functions useful in custom contexts.

## 2.0.0

- Complete redesign: Better separation between a simple object-oriented client, clear customization points and access to internals. Better discovery of features. This release is very much not backwards-compatible.

## 1.2.0

- Add functions to upload, download and remove whole directories.
- Add function to ensure a given remote path, creating all directories as necessary.

## 1.1.1

- Differentiate between Basic API and Convenience API in documentation.

## 1.1.0

- Add convenience functions to request and change the current working directory.
- Return positive response results whenever reasonable.

## 1.0.9

- Listeners using `once` wherever possible.

## 1.0.8

- Fix result for send command.

## 1.0.7

- Improve documentation.

## 1.0.6

- Close sockets on timeout.

## 1.0.5

- Close data socket explicitly after upload is done.

## 1.0.4

- List: Some servers send confirmation on control socket before the data arrived.

## 1.0.3

- List: Wait until server explicitly confirms that the transfer is complete.
- Upload: Close data socket manually when a stream ended.

## 1.0.2

Initial release