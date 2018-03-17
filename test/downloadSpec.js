const assert = require("assert");
const Client = require("../lib/ftp").Client;
const FileInfo = require("../lib/ftp").FileInfo;
const SocketMock = require("./SocketMock");

/**
 * Downloading a directory listing uses the same mechanism as downloading in general,
 * we don't need to repeat all tests for downloading files.
 */
describe("Download directory listing", function() {
    this.timeout(100);
    
    const bufList = Buffer.from("12-05-96  05:03PM       <DIR>          myDir");
    const expList = [
        (f = new FileInfo("myDir"), 
        f.size = 0,
        f.date = "12-05-96 05:03PM",
        f.type = FileInfo.Type.Directory, 
        f)
    ];
 
    let client;
    beforeEach(function() {
        client = new Client();
        client.prepareTransfer = ftp => {
            ftp.dataSocket = new SocketMock();
        };
        client.ftp.socket = new SocketMock();
    });

    afterEach(function() {
        client.close();
    });

    function requestListAndVerify(done) {
        client.list().then(result => {
            assert.deepEqual(result, expList);
            done();
        });        
    }

    it("sends the right command", function(done) {
        client.ftp.socket.once("didSend", command => {
            assert.equal(command, "LIST\r\n");
            done();
        });
        client.list();
    });

    it("handles data socket ending before control confirms", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("250 Done"));    
        });
    });

    it("handles control confirming before data socket ends", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.socket.emit("data", Buffer.from("250 Done"));    
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
        });
    });

    it("handles data coming in before control announces beginning", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("250 Done"));    
        });     
    });

    it("handles data transmission being complete before control announces beginning", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.socket.emit("data", Buffer.from("250 Done"));    
        });     
    });

    it("handles control announcing with 150 instead of 125", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", Buffer.from("150 Sending"));
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("250 Done"));    
        });
    });

    it("handles control confirming end with 200 instead of 250", function(done) {
        requestListAndVerify(done);
        setTimeout(() => {
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("200 Done"));    
        });
    });

    it("relays FTP error response even if data transmitted completely", function(done) {
        client.list().catch(err => {
            assert.equal(err.code, 500, "Error code");
            assert.equal(err.message, "500 Error");
            done();
        });
        setTimeout(() => {
            client.ftp.socket.emit("data", Buffer.from("125 Sending"));
            client.ftp.dataSocket.emit("data", bufList);
            client.ftp.dataSocket.end();
            client.ftp.socket.emit("data", Buffer.from("500 Error"));
        });
    });
});
