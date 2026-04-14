import { Writable } from "stream"
import { StringEncoding } from "./StringEncoding"

export class StringWriter extends Writable {

    protected byteLength = 0
    protected bufs: Buffer<ArrayBuffer>[] = []

    constructor(protected maxByteLength: number = 1 * 1024 * 1024) {
        super()
    }

    _write(chunk: Buffer | string | any, _: string, callback: (error: Error | null) => void) {
        if (!(chunk instanceof Buffer)) {
            callback(new Error("StringWriter: expects chunks of type 'Buffer'."))
            return
        }        
        if (this.byteLength + chunk.byteLength > this.maxByteLength) {
            callback(new Error(`StringWriter: Out of bounds. (maxByteLength=${this.maxByteLength})`))
            return
        }
        this.byteLength += chunk.byteLength
        this.bufs.push(chunk)
        callback(null)
    }

    getText(encoding: StringEncoding) {
        return Buffer.concat(this.bufs).toString(encoding);
    }
}
