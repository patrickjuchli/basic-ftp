const { describe, it } = require("node:test");
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

const listUnixWithInode = `
 1234567    4 -rw-r--r--   1 patrick  staff    487 Feb 25 19:03 package.json`

const listDOS = `
12-05-96  05:03PM       <DIR>          myDir
11-14-97  04:21PM                  953 MYFILE.INI`

const listMLSDWithPerm = `
type=file;size=24;modify=20250628164658.025;perm=rw; awesome.txt
type=file;size=9;modify=20250628164657.973;perm=rw; fake.txt
type=file;size=1091;modify=20250628164658.013;perm=rw; LICENSE`

const listEPLFComprehensive = `
+i8388621.29609,m824255902,/,	lib
+i640ecfac.1400000014a761,s1057,m1751129904,up644,r      LICENSE.txt`

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
            title: "MLSD with perm fact (perm fact ignored)",
            list: listMLSDWithPerm,
            exp: [
                (f = new FileInfo("awesome.txt"),
                f.type = FileType.File,
                f.size = 24,
                f.rawModifiedAt = "2025-06-28T16:46:58.025Z",
                f.modifiedAt = new Date("2025-06-28T16:46:58.025Z"),
                f),
                (f = new FileInfo("fake.txt"),
                f.type = FileType.File,
                f.size = 9,
                f.rawModifiedAt = "2025-06-28T16:46:57.973Z",
                f.modifiedAt = new Date("2025-06-28T16:46:57.973Z"),
                f),
                (f = new FileInfo("LICENSE"),
                f.type = FileType.File,
                f.size = 1091,
                f.rawModifiedAt = "2025-06-28T16:46:58.013Z",
                f.modifiedAt = new Date("2025-06-28T16:46:58.013Z"),
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
            title: "Unix list with inode and block count in front of an entry",
            list: listUnixWithInode,
            exp: [
                (f = new FileInfo("package.json"),
                f.group = "staff",
                f.size = 487,
                f.user = "patrick",
                f.permissions = {
                    user: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Write,
                    group: FileInfo.UnixPermission.Read,
                    world: FileInfo.UnixPermission.Read
                },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 25 19:03",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with spaces in group name",
            list: `-rw-r--r-- 1 patrick staff group 487 Feb 25 19:03 package.json`,
            exp: [
                (f = new FileInfo("package.json"),
                f.group = "staff group",
                f.size = 487,
                f.user = "patrick",
                f.permissions = {
                    user: FileInfo.UnixPermission.Read + FileInfo.UnixPermission.Write,
                    group: FileInfo.UnixPermission.Read,
                    world: FileInfo.UnixPermission.Read
                },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 25 19:03",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with a block count in front of an entry (ls -s)",
            list: `4 -rw-r--r--   1 patrick  staff   1057 Dec 11 14:35 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "staff",
                f.size = 1057,
                f.user = "patrick",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Dec 11 14:35",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with spaces in owner name",
            list: `-rw-r--r--   1 Domain Users  staff 12345 Feb 12 12:12 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "staff",
                f.size = 12345,
                f.user = "Domain Users",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 12 12:12",
                f.type = FileType.File,
                f)
            ]
        },
        {
            // The number of words per name is capped, see the note on backtracking in the parser.
            title: "Unix list with the maximum number of words in a group name",
            list: `-rw-r--r--   1 owner g1 g2 g3 g4 g5 g6 g7 g8 12345 Feb 12 12:12 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "g1 g2 g3 g4 g5 g6 g7 g8",
                f.size = 12345,
                f.user = "owner",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 12 12:12",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with a device using 'n, m' instead of a size",
            list: `crw-rw----   1 root     sys    10, 0 Jan 12  2005 kmem`,
            exp: [
                (f = new FileInfo("kmem"),
                f.group = "sys",
                f.size = 10,
                f.user = "root",
                f.permissions = { user: 6, group: 6, world: 0 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Jan 12 2005",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with a Japanese date",
            list: `-rw-r--r--   1 user     group  12345 1月 12日 2005年 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "group",
                f.size = 12345,
                f.user = "user",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "1月 12日 2005年",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with a symbolic link",
            list: `lrwxrwxrwx   1 neeme    neeme     23 Mar  2 18:06 macros -> /home/neeme/macros`,
            exp: [
                (f = new FileInfo("macros"),
                f.group = "neeme",
                f.size = 23,
                f.user = "neeme",
                f.link = "/home/neeme/macros",
                f.permissions = { user: 7, group: 7, world: 7 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Mar  2 18:06",
                f.type = FileType.SymbolicLink,
                f)
            ]
        },
        {
            title: "Unix list with a numeric date",
            list: `-rw-r--r--   1 user     group  12345 2004-02-12 12:12 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "group",
                f.size = 12345,
                f.user = "user",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "2004-02-12 12:12",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list with the day in front of the month",
            list: `-rw-r--r--   1 user     group  12345 12 Feb 12:12 f.txt`,
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "group",
                f.size = 12345,
                f.user = "user",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "12 Feb 12:12",
                f.type = FileType.File,
                f)
            ]
        },
        {
            title: "Unix list without a separator before the link count",
            list: `drwxr-xr-x2  user     group   4096 Feb  8 09:11 dir`,
            exp: [
                (f = new FileInfo("dir"),
                f.group = "group",
                f.size = 4096,
                f.user = "user",
                f.permissions = { user: 7, group: 5, world: 5 },
                f.hardLinkCount = 2,
                f.rawModifiedAt = "Feb  8 09:11",
                f.type = FileType.Directory,
                f)
            ]
        },
        {
            title: "Unix list with a negative user ID",
            list: `drwxrwx---   2 -1       60      4096 Sep 13  2006 shared`,
            exp: [
                (f = new FileInfo("shared"),
                f.group = "60",
                f.size = 4096,
                f.user = "-1",
                f.permissions = { user: 7, group: 7, world: 0 },
                f.hardLinkCount = 2,
                f.rawModifiedAt = "Sep 13 2006",
                f.type = FileType.Directory,
                f)
            ]
        },
        {
            title: "Unix list separated by tabs",
            list: "-rw-r--r--\t1\tuser\tgroup\t12345\tFeb 12\t12:12\tf.txt",
            exp: [
                (f = new FileInfo("f.txt"),
                f.group = "group",
                f.size = 12345,
                f.user = "user",
                f.permissions = { user: 6, group: 4, world: 4 },
                f.hardLinkCount = 1,
                f.rawModifiedAt = "Feb 12 12:12",
                f.type = FileType.File,
                f)
            ]
        },
        {
            // Anything but an inode or block count in front of an entry, see the parser.
            title: "Unix list with an unparsable prefix in front of an entry",
            list: `junk -rw-r--r--   1 patrick  staff   1057 Dec 11 14:35 f.txt`,
            exp: undefined
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
            title: "EPLF format - directory",
            list: `+i8388621.29609,m824255902,/,	bin`,
            exp: [
                (f = new FileInfo("bin"),
                f.type = FileType.Directory,
                f.rawModifiedAt = "1996-02-13T23:58:22.000Z",
                f.modifiedAt = new Date("1996-02-13T23:58:22.000Z"),
                f)
            ]
        },
        {
            title: "EPLF format - file with size",
            list: `+i8388621.44468,m824255902,r,s10376,	ls-lR.Z`,
            exp: [
                (f = new FileInfo("ls-lR.Z"),
                f.type = FileType.File,
                f.size = 10376,
                f.rawModifiedAt = "1996-02-13T23:58:22.000Z",
                f.modifiedAt = new Date("1996-02-13T23:58:22.000Z"),
                f)
            ]
        },
        {
            title: "EPLF format - file without size",
            list: `+i8388621.29609,m824255902,r,	file.txt`,
            exp: [
                (f = new FileInfo("file.txt"),
                f.type = FileType.File,
                f.rawModifiedAt = "1996-02-13T23:58:22.000Z",
                f.modifiedAt = new Date("1996-02-13T23:58:22.000Z"),
                f)
            ]
        },
        {
            title: "EPLF format - comprehensive test (all variants)",
            list: listEPLFComprehensive,
            exp: [
                (f = new FileInfo("lib"),
                f.type = FileType.Directory,
                f.rawModifiedAt = "1996-02-13T23:58:22.000Z",
                f.modifiedAt = new Date("1996-02-13T23:58:22.000Z"),
                f),
                (f = new FileInfo("LICENSE.txt"),
                f.type = FileType.File,
                f.size = 1057,
                f.rawModifiedAt = "2025-06-28T16:58:24.000Z",
                f.modifiedAt = new Date("2025-06-28T16:58:24.000Z"),
                f.permissions = {
                    user: 6,
                    group: 4,
                    world: 4
                },
                f)
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
        },
        {
            title: "Empty list with 'total 0' described in #206",
            list: "  \r\ntotal 0\r\n      \r\n  ",
            exp: []
        },
        {
            title: "Variation described in #193",
            list: "drw-r--rw   1     root     root         0 Apr 21 19:31 Directory1",
            exp: [
                (f = new FileInfo("Directory1"),
                f.size = 0,
                f.rawModifiedAt = "Apr 21 19:31",
                f.type = FileType.Directory,
                f.group = "root",
                f.user = "root",
                f.hardLinkCount = 1,
                f.permissions = {
                    user: 6,
                    group: 4,
                    world: 6
                },
                f)
            ]
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

/**
 * A listing comes from a remote server, parsing it must not let that server block the event loop.
 * The listings below took minutes to parse before the parser expressions were bounded and anchored.
 */
describe("Directory listing DoS resistance", function() {
    const maxDuration = 1000;

    function measure(list) {
        const start = Date.now();
        const files = parseList(list);
        return { files, duration: Date.now() - start };
    }

    it("handles a long Unix line that can't be parsed", function() {
        // Ends on a valid line because that's the one deciding which parser is used for the whole list.
        const list = "-rw-r--r-- 1 " + "a ".repeat(64 * 1024) + "!\r\n" + listUnixIssue61.trim();
        const { files, duration } = measure(list);
        assert.deepEqual(files.map(file => file.name), ["package.json"]);
        assert.ok(duration < maxDuration, `Parsing took ${duration}ms, expected less than ${maxDuration}ms`);
    });

    it("handles a long DOS line without whitespace", function() {
        const list = "x".repeat(256 * 1024) + "\r\n" + listDOS.trim();
        const { files, duration } = measure(list);
        assert.deepEqual(files.map(file => file.name), ["myDir", "MYFILE.INI"]);
        assert.ok(duration < maxDuration, `Parsing took ${duration}ms, expected less than ${maxDuration}ms`);
    });
});
