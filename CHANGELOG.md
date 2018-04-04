# Changelog

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