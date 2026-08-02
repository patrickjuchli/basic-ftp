import { Socket } from "net"

/** A transfer either sends data to or receives data from the data connection. */
export type TransferDirection = "upload" | "download"

/** How long to wait between two checks of a transfer at most, in milliseconds. */
const maxCheckIntervalMs = 500

/**
 * How many checks a timeout is split into, at least. A transfer is only reported as stalled if
 * every single one of them found the connection idle. Deciding on a single check would make brief
 * moments where a transfer looks idle without being stalled matter, for example just after a
 * destination signalled that it can accept data again but before the first bytes arrived.
 *
 * Splitting into n checks means such a moment has to last about (n-1)/n of the timeout to be
 * mistaken for a stall, so the value matters much less than it being greater than one. It only
 * has an effect on timeouts below `minChecksPerTimeout * maxCheckIntervalMs` anyway, longer ones
 * are split into more checks by the interval limit alone.
 */
const minChecksPerTimeout = 4

/**
 * Watches a data connection during a transfer and reports it as stalled if the server stopped
 * making progress.
 *
 * This replaces a plain inactivity timeout on the data socket. Such a timeout can't tell apart
 * "the server stopped sending" from "our own source or destination isn't ready yet". A slow local
 * stream is not an error: A download piped into a decompressor, or an upload fed by a stream that
 * computes its data, can legitimately leave the connection idle for minutes. Timing out on that
 * kills a healthy transfer and truncates the data the destination already received.
 *
 * Only time spent waiting for the server counts towards the timeout, see `isWaitingForServer`.
 */
export class TransferWatchdog {

    protected timer: NodeJS.Timeout | undefined = undefined

    /**
     * Start watching a transfer. Calls `onStall` if the server hasn't made progress for
     * `timeout` milliseconds. A timeout of 0 disables the watchdog.
     */
    start(socket: Socket, direction: TransferDirection, timeout: number, onStall: () => void) {
        this.stop()
        if (timeout <= 0) {
            return
        }
        const intervalMs = Math.max(1, Math.min(Math.floor(timeout / minChecksPerTimeout), maxCheckIntervalMs))
        let lastBytes = countBytes(socket)
        let idleMs = 0
        this.timer = setInterval(() => {
            const bytes = countBytes(socket)
            const madeProgress = bytes !== lastBytes
            lastBytes = bytes
            if (madeProgress || !isWaitingForServer(socket, direction)) {
                idleMs = 0
                return
            }
            // Count checks instead of measuring elapsed time: a blocked event loop delays our
            // checks just as much as it delays reading from the socket, and that's not something
            // the server should be blamed for.
            idleMs += intervalMs
            if (idleMs >= timeout) {
                this.stop()
                onStall()
            }
        }, intervalMs)
        // Don't keep the process alive just to watch a transfer.
        this.timer.unref()
    }

    /**
     * Stop watching. Safe to call at any time, also if no transfer is being watched.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = undefined
        }
    }
}

function countBytes(socket: Socket): number {
    return socket.bytesRead + socket.bytesWritten
}

/**
 * Returns true if the transfer can only continue once the server acts. When downloading, that's
 * the case as long as we're ready to receive: if the socket is paused, our destination applied
 * backpressure and the server may well be waiting for us. When uploading, it's the case if we
 * still have data queued that the server isn't accepting: an empty queue means we're waiting for
 * our own source instead.
 *
 * `isPaused()` only reports backpressure for a socket that is being piped, which is what
 * `downloadTo` in transfer.ts does. Should that ever change to reading the socket directly, e.g.
 * by iterating over it, this would report a transfer as stalled while it's waiting for us.
 */
function isWaitingForServer(socket: Socket, direction: TransferDirection): boolean {
    return direction === "download" ? !socket.isPaused() : socket.writableLength > 0
}
