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

/**
 * Returns true if an IP is a private address according to https://tools.ietf.org/html/rfc1918#section-3.
 * This will handle IPv4-mapped IPv6 addresses correctly but return false for all other IPv6 addresses.
 *
 * @param ip  The IP as a string, e.g. "192.168.0.1"
 */
export function ipIsPrivateV4Address(ip = ""): boolean {
    // Handle IPv4-mapped IPv6 addresses like ::ffff:192.168.0.1
    if (ip.startsWith("::ffff:")) {
        ip = ip.substr(7) // Strip ::ffff: prefix
    }
    const octets = ip.split(".").map(o => parseInt(o, 10))
    return octets[0] === 10                                             // 10.0.0.0 - 10.255.255.255
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)    // 172.16.0.0 - 172.31.255.255
        || (octets[0] === 192 && octets[1] === 168)                    // 192.168.0.0 - 192.168.255.255
}