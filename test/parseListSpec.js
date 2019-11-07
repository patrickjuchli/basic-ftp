const assert = require("assert");
const { parseList } = require("../dist/parseList");
const { FileInfo, FileType } = require("../dist");
const { parseMLSxDate } = require("../dist/parseListMLSD")
/**
 * As the parsers themselves are based on the implementation of the Apache Net Commons FTP parser
 * we don't need to test every edge case here again.
 */

const listUnix = `
total 112
 drwxr-xr-x+  11 patrick  staff    374 Dec 11 21:24 .
 drwxr-xr-x+  38 patrick  staff   1292 Dec 11 14:31 ..
    -rw-r--r--+   1 patrick  staff   1057 Dec 11 14:35 LICENSE.txt
 drwxr-xr-x+   5 patrick  staff    170 Dec 11 17:24 lib


` // keep the empty lines

const listUnixIssue61 = `
drwxr-xr-x    2 1001     1001         4096 Feb 25 19:03 .
dr-xr-xr-x    3 1001     1001         4096 Feb 25 18:55 ..
-rw-------    1 1001     1001          487 Feb 25 19:03 package.json`

const listDOS = `
12-05-96  05:03PM       <DIR>          myDir
11-14-97  04:21PM                  953 MYFILE.INI`

describe("Directory listing", function() {
    let f;
    const tests = [
        {
            title: "MLSD detect list type",
            list: `anything=something; filename`,
            exp: [
                new FileInfo("filename")
            ]
        },
        {
            title: "MLSD detect list type (filename only)",
            list: ` filename`,
            exp: [
                new FileInfo("filename")
            ]
        },
        {
            title: "MLSD folder",
            list: `size=11;type=dir;modify=20190218120006; folder`,
            exp: [
                (f = new FileInfo("folder"),
                f.size = 11,
                f.rawModifiedAt = "2019-02-18T12:00:06.000Z",
                f.modifiedAt = new Date("2019-02-18T12:00:06.000Z"),
                f.type = FileType.Directory,
                f)
            ]
        },
        {
            title: "MLSD ignore current folder by fact",
            list: `type=cdir; .`,
            exp: []
        },
        {
            title: "MLSD ignore parent folder by fact",
            list: `type=pdir; ..`,
            exp: []
        },
        {
            title: "MLSD ignore current folder by name (issue #99)",
            list: `type=dir; .`,
            exp: []
        },
        {
            title: "MLSD ignore parent folder by name (issue #99)",
            list: `type=dir; ..`,
            exp: []
        },
        {
            title: "MLSD file",
            list: `size=11;type=file;modify=20181025120459; file one`,
            exp: [
                (f = new FileInfo("file one"),
                f.size = 11,
                f.type = FileType.File,
                f.rawModifiedAt = "2018-10-25T12:04:59.000Z",
                f.modifiedAt = new Date("2018-10-25T12:04:59.000Z"),
                f)
            ]
        },
        {
            title: "MLSD ignore case of fact types",
            list: `SiZe=11;tYpe=file;MoDIfy=20181025120459;uNIx.MOde=0755; file one`,
            exp: [
                (f = new FileInfo("file one"),
                f.size = 11,
                f.type = FileType.File,
                f.rawModifiedAt = "2018-10-25T12:04:59.000Z",
                f.modifiedAt = new Date("2018-10-25T12:04:59.000Z"),
                f.permissions = {
                    user: 7,
                    group: 5,
                    world: 5
                },
                f)
            ]
        },
        {
            title: "MLSD handle 'sizd' (Issue 95)",
            list: `sizd=4096; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.size = 4096,
                f),
            ]
        },
        {
            title: "MLSD handle fact 'UNIX.mode'",
            list: `UNIX.mode=0755; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.permissions = {
                    user: 7,
                    group: 5,
                    world: 5
                },
                f),
            ]
        },
        {
            title: "MLSD handle fact 'UNIX.owner', 'UNIX.group'",
            list: `UNIX.owner=11;UNIX.group=22; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.user = "11",
                f.group = "22",
                f),
            ]
        },
        {
            title: "MLSD handle fact 'UNIX.uid', 'UNIX.gid'",
            list: `UNIX.uid=11;UNIX.gid=22; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.user = "11",
                f.group = "22",
                f),
            ]
        },
        {
            title: "MLSD handle fact 'UNIX.ownername', 'UNIX.groupname'",
            list: `UNIX.ownername=myself;UNIX.groupname=mygroup;UNIX.owner=11;UNIX.group=22; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.user = "myself",
                f.group = "mygroup",
                f),
            ]
        },
        {
            title: "MLSD symbolic link using 'OS.unix=slink:<target>'",
            list: `type=OS.unix=slink:/actual/target; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.type = FileType.SymbolicLink,
                f.link = "/actual/target",
                f),
            ]
        },
        {
            title: "MLSD symbolic link without target using 'OS.unix=slink:<target>'",
            list: `type=OS.unix=slink:; filename`,
            exp: [
                (f = new FileInfo("filename"),
                f.type = FileType.SymbolicLink,
                f.link = "",
                f),
            ]
        },
        {
            title: "MLSD symbolic link using 'type=OS.unix=symlink', target outside of directory",
            list: "type=OS.unix=symlink;unique=1234; filename\ntype=file;unique=1; anotherfile\ntype=file;unique=1234; /actual/target",
            exp: [
                (f = new FileInfo("filename"),
                f.type = FileType.SymbolicLink,
                f.link = "/actual/target",
                f.uniqueID = "1234",
                f),
                (f = new FileInfo("anotherfile"),
                f.type = FileType.File,
                f.uniqueID = "1",
                f)
            ]
        },
        {
            title: "MLSD two symbolic links using 'type=OS.unix=symlink', pointing to same target",
            list: "type=OS.unix=symlink;unique=1234; file1\ntype=OS.unix=symlink;unique=1234; file2\ntype=file;unique=1234; /actual/target",
            exp: [
                (f = new FileInfo("file1"),
                f.type = FileType.SymbolicLink,
                f.link = "/actual/target",
                f.uniqueID = "1234",
                f),
                (f = new FileInfo("file2"),
                f.type = FileType.SymbolicLink,
                f.link = "/actual/target",
                f.uniqueID = "1234",
                f)
            ]
        },
        {
            title: "MLSD symbolic link using 'type=OS.unix=symlink', target is part of directory",
            list: "type=OS.unix=symlink;unique=1234; filename\ntype=file;unique=1234; target",
            exp: [
                (f = new FileInfo("filename"),
                f.type = FileType.SymbolicLink,
                f.link = "target",
                f.uniqueID = "1234",
                f),
                (f = new FileInfo("target"),
                f.type = FileType.File,
                f.uniqueID = "1234",
                f)
            ]
        },
        {
            title: "MLSD symbolic link using 'type=OS.unix=symlink', but no identifier",
            list: "type=OS.unix=symlink; filename\ntype=file; target",
            exp: [
                (f = new FileInfo("filename"),
                f.type = FileType.SymbolicLink,
                f),
                (f = new FileInfo("target"),
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Regular Unix list",
            list: listUnix,
            exp: [
                (f = new FileInfo("LICENSE.txt"),
                f.group = "staff",
                f.size = 1057,
                f.user = "patrick",
                f.permissions = {
                    user: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Write,
                    group: FileInfo.UnixPermission.Read,
                    world: FileInfo.UnixPermission.Read
                },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Dec 11 14:35",
                f.type = FileType.File,
                f),
                (f = new FileInfo("lib"),
                f.group = "staff",
                f.size = 170,
                f.user = "patrick",
                f.permissions = {
                    user: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Write + FileInfo.UnixPermission.Execute,
                    group: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Execute,
                    world: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Execute
                },
                f.hardLinkCount = 5,
                f.rawModifiedAt = "Dec 11 17:24",
                f.type = FileType.Directory,
                f),
            ]
        },
        {
            title: "Unix list Issue 61",
            list: listUnixIssue61,
            exp: [
                (f = new FileInfo("package.json"),
                f.group = "1001",
                f.size = 487,
                f.user = "1001",
                f.permissions = {
                    user: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Write,
                    group: 0,
                    world: 0
                },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 25 19:03",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Regular DOS list",
            list: listDOS,
            exp: [
                (f = new FileInfo("myDir"),
                f.size = 0,
                f.rawModifiedAt = "12-05-96 05:03PM",
                f.type = FileType.Directory,
                f),
                (f = new FileInfo("MYFILE.INI"),
                f.size = 953,
                f.rawModifiedAt = "11-14-97 04:21PM",
                f.type = FileType.File,
                f),
            ]
        },
        {
            title: "Unknown format",
            list: "aaa",
            exp: undefined
        },
        {
            title: "Unknown format (MVS)",
            list: "SAVE01 3390   2004/06/23  1    1  FB     128  6144  PO    INCOMING.RPTBM024.D061704",
            exp: undefined
        },
        {
            title: "Empty list",
            list: "  \r\n  \r\n      \r\n  ",
            exp: []
        }
    ];
    for (const test of tests) {
        it(test.title, function() {
            if (test.exp) {
                const actual = parseList(test.list);
                assert.deepEqual(actual, test.exp);
            }
            else {
                assert.throws(function() {
                    parseList(test.list);
                });
            }
        });
    }
});

describe("MLSx Date", function() {
    const tests = [{
        input: "19991005213102",
        exp: "1999-10-05T21:31:02.000Z"
    }, {
        input: "19991005213102.014",
        exp: "1999-10-05T21:31:02.014Z"
    }]
    for (const test of tests) {
        it(test.input, function() {
            const actual = parseMLSxDate(test.input)
            assert.equal(actual.toISOString(), test.exp)
        })
    }
})
