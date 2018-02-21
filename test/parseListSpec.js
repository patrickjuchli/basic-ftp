const assert = require("assert");
const parseList = require("../lib/parseList");
const FileInfo = require("../lib/FileInfo");

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
`;

const listDOS = `
12-05-96  05:03PM       <DIR>          myDir
11-14-97  04:21PM                  953 MYFILE.INI`;

const listUnknown = `
a
b
`
const listUnknownMVS = `
SAVE00 3390   2004/06/23  1    1  FB     128  6144  PS    INCOMING.RPTBM023.D061704
SAVE01 3390   2004/06/23  1    1  FB     128  6144  PO    INCOMING.RPTBM024.D061704
`;

describe("Directory listing", function() {
    const tests = [
        {
            title: "Regular Unix list",
            list: listUnix,
            exp: [
                (f = new FileInfo("LICENSE.txt"), 
                    f.group = "staff", 
                    f.size = 1057, 
                    f.user = "patrick",
                    f.permissions = {
                        user: FileInfo.Permission.Read + FileInfo.Permission.Write,
                        group: FileInfo.Permission.Read,
                        world: FileInfo.Permission.Read
                    },
                    f.hardLinkCount = 1,
                    f.date = "Dec 11 14:35",
                    f.type = FileInfo.Type.File,
                    f),
                (f = new FileInfo("lib"), 
                    f.group = "staff", 
                    f.size = 170, 
                    f.user = "patrick", 
                    f.permissions = {
                        user: FileInfo.Permission.Read + FileInfo.Permission.Write + FileInfo.Permission.Execute,
                        group: FileInfo.Permission.Read + FileInfo.Permission.Execute,
                        world: FileInfo.Permission.Read + FileInfo.Permission.Execute
                    },
                    f.hardLinkCount = 5,
                    f.date = "Dec 11 17:24",
                    f.type = FileInfo.Type.Directory, 
                    f),
            ]  
        },
        {
            title: "Regular DOS list",
            list: listDOS,
            exp: [
                (f = new FileInfo("myDir"), 
                    f.size = 0,
                    f.date = "12-05-96 05:03PM",
                    f.type = FileInfo.Type.Directory, 
                    f),
                (f = new FileInfo("MYFILE.INI"), 
                    f.size = 953,
                    f.date = "11-14-97 04:21PM",
                    f.type = FileInfo.Type.File, 
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
