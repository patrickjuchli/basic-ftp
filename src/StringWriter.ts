import { Writable } from "stream"
import { StringEncoding } from "./StringEncoding"

export class StringWriter extends Writable {

    protected buf = Buffer.alloc(0)

    _write(chunk: Buffer | string | any, _: string, callback: (error: Error | null) => void) {
        if (chunk instanceof Buffer) {
            this.buf = Buffer.concat([this.buf, chunk])
            callback(null)
        }
        else {
            callback(new Error("StringWriter expects chunks of type 'Buffer'."))
        }
    }

    getText(encoding: StringEncoding) {
        return this.buf.toString(encoding)
    }
}
