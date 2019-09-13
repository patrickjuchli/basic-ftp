const assert = require("assert");
const { parseList } = require("../dist/parseList");
const { FileInfo, FileType } = require("../dist");

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

const listMLSD = `
size=23;type=dir;perm=el;modify=20190218120006; folder1
size=23;type=cdir;perm=el;modify=20190218120006; current folder
size=23;type=pdir;perm=el;modify=20190218120006; parent folder
Size=138;Type=file;Perm=el;Modify=20181025120459;UNIX.mode=0755;UNIX.owner=1001;UNIX.group=2002;UNIX.ownername=test; file one
 filename only`

const listUnknown = `
a
b`;

const listUnknownMVS = `
SAVE00 3390   2004/06/23  1    1  FB     128  6144  PS    INCOMING.RPTBM023.D061704
SAVE01 3390   2004/06/23  1    1  FB     128  6144  PO    INCOMING.RPTBM024.D061704`;

describe("Directory listing", function() {
    let f;
    const tests = [
        {
            title: "MLSD",
            list: listMLSD,
            exp: [
                (f = new FileInfo("folder1"),
                f.size = 23,
                f.date = "2019-02-18T12:00:06.000Z",
                f.modifiedAt = new Date("2019-02-18T12:00:06.000Z"),
                f.type = FileType.Directory,
                f),
                (f = new FileInfo("file one"),
                f.size = 138,
                f.date = "2018-10-25T12:04:59.000Z",
                f.modifiedAt = new Date("2018-10-25T12:04:59.000Z"),
                f.user = "test",
                f.group = "2002",
                f.permissions = {
                    user: 7,
                    group: 5,
                    world: 5
                },
                f.type = FileType.File,
                f),
                (f = new FileInfo("filename only"),
                f),
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
                f.date = "Dec 11 14:35",
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
                f.date = "Dec 11 17:24",
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
                f.date = "Feb 25 19:03",
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
                f.date = "12-05-96 05:03PM",
                f.type = FileType.Directory,
                f),
                (f = new FileInfo("MYFILE.INI"),
                f.size = 953,
                f.date = "11-14-97 04:21PM",
                f.type = FileType.File,
                f),
            ]
        },
        {
            title: "Unknown format",
            list: listUnknown,
            exp: undefined
        },
        {
            title: "Unknown format (MVS)",
            list: listUnknownMVS,
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
