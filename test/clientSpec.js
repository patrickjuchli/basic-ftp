const assert = require("assert");
const Client = require("../lib/ftp").Client;
const SocketMock = require("./SocketMock");

const featReply = `
211-Extensions supported:
 MLST size*;create
 SIZE
211 END
`;

const featEmptyReply = `
211 No features
`;

describe("Convenience API", function() {
    this.timeout(100);
    let client;
    beforeEach(function() {
        client = new Client();
        client.prepareTransfer = () => {}; // Don't change
        client.ftp.socket = new SocketMock();
        client.ftp.dataSocket = new SocketMock();
    });

    it("can get a filesize", function() {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "SIZE file.txt\r\n");
            client.ftp.socket.emit("data", Buffer.from("213 1234\r\n"));
        });
        return client.size("file.txt").then(result => {
            assert.equal(result, 1234);
        });
    });

    it("can get features", function() {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "FEAT\r\n");
            client.ftp.socket.emit("data", Buffer.from(featReply));
        });
        return client.features().then(result => {
            assert.deepEqual([...result.keys()], ["MLST", "SIZE"], "Feature keys");
            assert.deepEqual([...result.values()], ["size*;create", ""], "Feature values")
        });        
    });

    it("can handle empty feature response", function() {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "FEAT\r\n");
            client.ftp.socket.emit("data", Buffer.from(featEmptyReply));
        });
        return client.features().then(result => {
            assert.deepEqual([...result.keys()], [], "Feature keys");
            assert.deepEqual([...result.values()], [], "Feature values")
        });        
    });

    it("can handle error when requesting features", function() {
        client.ftp.socket.once("didSend", buf => {
            assert.equal(buf.toString(), "FEAT\r\n");
            client.ftp.socket.emit("data", Buffer.from("500 Error\r\n"));
        });
        return client.features().then(result => {
            assert.deepEqual([...result.keys()], [], "Feature keys");
            assert.deepEqual([...result.values()], [], "Feature values")
        });        
    });
});