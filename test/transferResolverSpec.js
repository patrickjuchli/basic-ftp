const assert = require("assert");
const TransferResolver = require("../lib/ftp").utils.TransferResolver;

describe("TransferResolver", function() {

    let resolver;
    beforeEach(function() {
        resolver = new TransferResolver({
            dataSocket: true
        });
    });
    
    it("handles resolve, then confirm", function(done) {
        let bothCalled = false;
        const task = {
            resolve(result) {
                assert(bothCalled);
                assert.equal(result, "result");
                done();
            }
        }
        resolver.resolve(task, "result");
        bothCalled = true;
        resolver.confirm(task);
    });

    it("handles confirm, then resolve", function(done) {
        const task = {
            resolve(result) {
                assert.equal(result, "result");
                done();
            }
        }
        resolver.confirm(task);
        resolver.resolve(task, "result");
    });

    it("rejects the task with the error", function(done) {
        const task = {
            reject(reason) {
                assert.equal(reason, "reason");
                done();
            }
        }
        resolver.confirm(task, "something");
        resolver.reject(task, "reason");
    });

    it("resolving destroys data socket", function() {
        const task = {
            resolve() {},
        }
        assert.equal(resolver.ftp.dataSocket, true);
        resolver.resolve(task, "foo");
        assert.equal(resolver.ftp.dataSocket, true);
        resolver.confirm(task);
        assert.equal(resolver.ftp.dataSocket, undefined, "dataSocket not set to undefined");
    });

    it("rejecting destroys data socket", function() {
        const task = {
            reject() {},
        }
        assert.equal(resolver.ftp.dataSocket, true);
        resolver.reject(task, "foo");
        assert.equal(resolver.ftp.dataSocket, undefined, "dataSocket not set to undefined");
    });
});
