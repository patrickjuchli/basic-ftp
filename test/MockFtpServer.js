const net = require("net")

const NEWLINE = `\r\n`
const DEFAULT_HANDLERS = {
    user: ({arg}) => arg === "test" ? "331 Need password" : "530 Unknown user",
    pass: ({arg}) => arg === "test" ? "200 OK" : "530 Wrong password",
    type: () => "200 OK",
    quit: () => "200 Bye"
}

module.exports = class MockFtpServer {
    constructor() {
        this.didOpenDataConn = () => {}
        this.didStartTransfer = () => {}
        this.didCloseDataConn = () => {}
        this.receivedCommands = []
        this.connections = []
        this.uploadedData = undefined
        this.handlers = DEFAULT_HANDLERS
        this.ctrlConn = undefined
        this.ctrlServer = net.createServer(conn => {
            this.ctrlConn = conn
            this.connections.push(conn)
            conn.allowHalfOpen = true
            conn.write(`200 Welcome${NEWLINE}`)
            conn.on("data", data => {
                const command = data.toString().trim()
                this.receivedCommands.push(command)
                const parts = command.split(" ", 2)
                const method = parts[0].toLowerCase()
                const arg = parts[1]
                if (this.handlers[method]) {
                    const response = this.handlers[method]({arg})
                    conn.write(`${response}${NEWLINE}`)
                } else {
                    conn.write(`500 Unknown command: "${method}"`)
                }
            })
        })
        this.dataConn = undefined
        this.dataServer = net.createServer(conn => {
            this.dataConn = conn
            this.connections.push(conn)
            this.didOpenDataConn()
            const bufs = []
            conn.on("data", data => {
                if (bufs.length === 0) this.didStartTransfer()
                bufs.push(data)
            })
            conn.on("close", () => {
                this.uploadedData = Buffer.concat(bufs)
                this.didCloseDataConn()
                this.writeCtrl("200 Transfer done")
            })
        })
        this.ctrlServer.listen()
        this.dataServer.listen()
    }

    writeCtrl(payload) {
        this.ctrlConn.write(`${payload}${NEWLINE}`)
    }

    close() {
        for (const conn of this.connections) {
            conn.destroy()
        }
        this.ctrlServer.close()
        this.dataServer.close()
    }

    get dataAddressForPasvResponse() {
        const port = this.dataServer.address().port
        const p1 = Math.floor(port / 256)
        const p2 = port % 256
        return `127,0,0,1,${p1},${p2}`
    }

    get dataAddress() {
        return this.dataServer.address()
    }

    get ctrlAddress() {
        return this.ctrlServer.address()
    }

    addHandlers(handlers) {
        this.handlers = { ...DEFAULT_HANDLERS, ...handlers }
    }
}