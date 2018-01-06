# Changelog

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