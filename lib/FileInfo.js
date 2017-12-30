"use strict";

/**
 * Holds information about a remote file.
 */
module.exports = class FileInfo {

    static get Type() {
        return {
            File: 0,
            Directory: 1,
            SymbolicLink: 2,
            Unknown: 3                    
        };
    }

    static get Permission() {
        return {
            Read: 1,
            Write: 2,
            Execute: 4        
        };
    }

    /**
     * @param {string} name 
     */
    constructor(name) {
        this.name = name;
        this.type = FileInfo.Type.Unknown;
        this.size = -1;
        this.hardLinkCount = 0;
        this.permissions = {
            user: 0,
            group: 0,
            world: 0
        };
        this.link = "";
        this.group = "";
        this.user = "";
        this.date = "";
    }

    get isFile() {
        return this.type === FileInfo.Type.File;
    }

    get isDirectory() {
        return this.type === FileInfo.Type.Directory;
    }

    get isSymbolicLink() {
        return this.type === FileInfo.Type.SymbolicLink;
    }
};
