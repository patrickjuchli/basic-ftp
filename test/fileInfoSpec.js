const assert = require("assert");
const { FileInfo, FileType } = require("../dist");

describe("FileInfo", function() {

    it("can report type of file", function() {
        const f = new FileInfo("");
        f.type = FileType.File;
        assert(f.isFile);
    });

    it("can report type of directory", function() {
        const f = new FileInfo("");
        f.type = FileType.Directory;
        assert(f.isDirectory);
    });

    it("can report type of symbolic link", function() {
        const f = new FileInfo("");
        f.type = FileType.SymbolicLink;
        assert(f.isSymbolicLink);
    });
});