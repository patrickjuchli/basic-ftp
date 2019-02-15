import { Writable } from "stream";

export class StringWriter extends Writable {
    protected buf = Buffer.alloc(0)

    constructor() {
        super()
        this._write = (chunk, _, done) => {
            if (chunk) {
                if (chunk instanceof Buffer) {
                    this.buf = Buffer.concat([this.buf, chunk])
                }
                else {
                    done(new Error("StringWriter expects chunks of type 'Buffer'."))
                    return
                }
            }
            done()
        }
    }

    getText(encoding: string) {
        return this.buf.toString(encoding)
    }
}
