export enum FileType {
    Unknown = 0,
    File,
    Directory,
    SymbolicLink
}

export interface UnixPermissions {
    readonly user: number
    readonly group: number
    readonly world: number
}

/**
 * Describes a file, directory or symbolic link. Note that FTP file listings are not standardized. It depends
 * on the operating system of the FTP server how complete the information is.
 */
export class FileInfo {

    static UnixPermission = {
        Read: 4,
        Write: 2,
        Execute: 1
    }

    type = FileType.Unknown
    size = 0
    /**
     * Unix permissions if present. If the underlying FTP server is not running on Unix or doesn't report
     * permissions this will be undefined. If set, you might be able to edit permissions with the FTP command `SITE CHMOD`.
     */
    permissions: UnixPermissions | undefined
    hardLinkCount = 0
    link = ""
    group = ""
    user = ""
    /**
     * Unparsed date as a string. Be careful when trying to parse this by yourself. There is no
     * standard format on which FTP servers agree when using the LIST command. Date information is meant
     * to be human-readable but not necessarily easy to parse. See `modifiedAt` for a parsed date.
     */
    date = ""
    /**
     * Parsed modification date is available (and reliable) if the MLSD command is supported by the FTP server.
     */
    modifiedAt: Date | undefined

    constructor(public name: string) {
        this.name = name
    }

    get isDirectory(): boolean {
        return this.type === FileType.Directory
    }

    get isSymbolicLink(): boolean {
        return this.type === FileType.SymbolicLink
    }

    get isFile(): boolean {
        return this.type === FileType.File
    }
}
