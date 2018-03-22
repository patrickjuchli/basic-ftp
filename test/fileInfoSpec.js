const assert = require("assert");
const FileInfo = require("../lib/FileInfo");

describe("FileInfo", function() {
    
    it("can report type of file", function() {
        const f = new FileInfo("");
        f.type = FileInfo.Type.File;
        assert(f.isFile);
    });

    it("can report type of directory", function() {
        const f = new FileInfo("");
        f.type = FileInfo.Type.Directory;
        assert(f.isDirectory);
    });

    it("can report type of symbolic link", function() {
        const f = new FileInfo("");
        f.type = FileInfo.Type.SymbolicLink;
        assert(f.isSymbolicLink); 
    });
});