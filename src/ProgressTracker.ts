import { Socket } from "net"

export type ProgressType = "upload" | "download" | "list"

/**
 * Describes progress of file transfer.
 */
export interface ProgressInfo {
    /** A name describing this info, e.g. the filename of the transfer. */
    readonly name: string
    /** The type of transfer, typically "upload" or "download". */
    readonly type: ProgressType
    /** Transferred bytes in current transfer. */
    readonly bytes: number
    /** Transferred bytes since last counter reset. Useful for tracking multiple transfers. */
    readonly bytesOverall: number
}

export type ProgressHandler = (info: ProgressInfo) => void

/**
 * Tracks progress of one socket data transfer at a time.
 */
export class ProgressTracker {
    bytesOverall = 0
    protected readonly intervalMs = 500
    protected onStop: (stopWithUpdate: boolean) => void = noop
    protected onHandle: ProgressHandler = noop

    /**
     * Register a new handler for progress info. Use `undefined` to disable reporting.
     */
    reportTo(onHandle: ProgressHandler = noop) {
        this.onHandle = onHandle
    }

    /**
     * Start tracking transfer progress of a socket.
     *
     * @param socket  The socket to observe.
     * @param name  A name associated with this progress tracking, e.g. a filename.
     * @param type  The type of the transfer, typically "upload" or "download".
     */
    start(socket: Socket, name: string, type: ProgressType) {
        let lastBytes = 0
        this.onStop = poll(this.intervalMs, () => {
            const bytes = socket.bytesRead + socket.bytesWritten
            this.bytesOverall += bytes - lastBytes
            lastBytes = bytes
            this.onHandle({
                name,
                type,
                bytes,
                bytesOverall: this.bytesOverall
            })
        })
    }

    /**
     * Stop tracking transfer progress.
     */
    stop() {
        this.onStop(false)
    }

    /**
     * Call the progress handler one more time, then stop tracking.
     */
    updateAndStop() {
        this.onStop(true)
    }
}

/**
 * Starts calling a callback function at a regular interval. The first call will go out
 * immediately. The function returns a function to stop the polling.
 */
function poll(intervalMs: number, updateFunc: () => void): (stopWithUpdate: boolean) => void {
    const id = setInterval(updateFunc, intervalMs)
    const stopFunc = (stopWithUpdate: boolean) => {
        clearInterval(id)
        if (stopWithUpdate) {
            updateFunc()
        }
        // Prevent repeated calls to stop calling handler.
        updateFunc = noop
    }
    updateFunc()
    return stopFunc
}

function noop() { /*Do nothing*/ }
