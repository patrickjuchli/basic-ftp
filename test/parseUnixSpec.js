const assert = require("assert");
const parseListUnix = require("../lib/parseListUnix");
const FileInfo = require("../lib/FileInfo");

const listNormal = `
total 112
drwxr-xr-x+  11 patrick  staff    374 Dec 11 21:24 .
drwxr-xr-x+  38 patrick  staff   1292 Dec 11 14:31 ..
-rw-r--r--+   1 patrick  staff   1057 Dec 11 14:35 LICENSE.txt
drwxr-xr-x+   5 patrick  staff    170 Dec 11 17:24 lib
`;

describe("Unix list parser", function() {
    const tests = [
        {
            title: "Regular list",
            list: listNormal,
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
                    f.type = FileInfo.Type.File, f),
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
                    f.type = FileInfo.Type.Directory, f),
            ]  
        }
    ];
    for (const test of tests) {
        it(test.title, function() {
            const actual = parseListUnix(test.list);
            assert.deepEqual(actual, test.exp);
        });        
    }
});