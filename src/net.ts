import { Socket } from "net"
import { connect as connectTLS, ConnectionOptions, TLSSocket } from "tls"

/**
 * Returns a string describing the encryption on a given socket instance.
 */
export function describeTLS(socket: Socket | TLSSocket): string {
    if (socket instanceof TLSSocket) {
        const protocol = socket.getProtocol()
        return protocol ? protocol : "Server socket or disconnected client socket"
    }
    return "No encryption"
}

/**
 * Returns a string describing the remote address of a socket.
 */
export function describeAddress(socket: Socket): string {
    if (socket.remoteFamily === "IPv6") {
        return `[${socket.remoteAddress}]:${socket.remotePort}`
    }
    return `${socket.remoteAddress}:${socket.remotePort}`
}

/**
 * Upgrade a socket connection with TLS.
 */
export function upgradeSocket(socket: Socket, options: ConnectionOptions): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
        const tlsOptions = Object.assign({}, options, {
            socket
        })
        const tlsSocket = connectTLS(tlsOptions, () => {
            const expectCertificate = tlsOptions.rejectUnauthorized !== false
            if (expectCertificate && !tlsSocket.authorized) {
                reject(tlsSocket.authorizationError)
            }
            else {
                // Remove error listener added below.
                tlsSocket.removeAllListeners("error")
                resolve(tlsSocket)
            }
        }).once("error", error => {
            reject(error)
        })
    })
}
