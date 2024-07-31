/**
 * This cache is used for RSC fetches, so that we don't re-fetch the same
 * component (i.e. page) multiple times and get stuck in a loop.
 *
 * `key`: A stringified location-like object.
 * `value`: A Promise that resolves to a React element.
 */
export class RscCache {
  private cache = new Map<string, Thenable<React.ReactElement>>()
  private socket: WebSocket
  private sendRetries = 0
  private isEnabled = true

  constructor() {
    this.socket = new WebSocket('ws://localhost:18998')

    // Event listener for WebSocket connection open
    this.socket.addEventListener('open', () => {
      console.log('Connected to WebSocket server.')
    })

    // Event listener for incoming messages
    this.socket.addEventListener('message', (event) => {
      console.log('Incomming message', event)
      if (event.data.startsWith('{')) {
        const data = JSON.parse(event.data)

        console.log('Incomming message id', data.id)
        console.log('Incomming message key', data.key)

        if (data.id === 'rsc-cache-delete') {
          if (!this.cache.has(data.key)) {
            console.error('')
            console.error(
              'RscCache::message::rsc-cache-delete key not found in cache',
            )
            console.error('')
          }
          this.cache.delete(data.key)

          this.sendToWebSocket('update', {
            fullCache: Object.fromEntries(
              Array.from(this.cache.entries()).map(
                ([location, elementThenable]) => [
                  location,
                  // @ts-expect-error hack to get the value of a Thenable
                  elementThenable.value,
                ],
              ),
            ),
          })
        } else if (data.id === 'rsc-cache-clear') {
          this.cache.clear()
          this.sendToWebSocket('update', { fullCache: {} })
        } else if (data.id === 'rsc-cache-enable') {
          console.log('RscCache::message::rsc-cache-enable')
          this.isEnabled = true
        } else if (data.id === 'rsc-cache-disable') {
          console.log('RscCache::message::rsc-cache-disable')
          this.isEnabled = false
        }
      }
    })
  }

  get(key: string): Thenable<React.ReactElement> | undefined {
    const value = this.cache.get(key)
    console.log('RscCache.get', key, value)
    return value
  }

  set(key: string, value: Thenable<React.ReactElement>) {
    console.log('RscCache.set', key, value)

    if (!this.isEnabled) {
      // Always clear the cache if the cache is disabled
      this.cache.clear()
    }

    this.cache.set(key, value)

    // There's no point in sending a Promise over the WebSocket, so we wait for
    // it to resolve before sending the value.
    value.then((resolvedValue) => {
      console.log('RscCache.set key:', key)
      console.log('RscCache.set resolved value:', resolvedValue)
      this.sendToWebSocket('set', {
        updatedKey: key,
        fullCache: Object.fromEntries(
          Array.from(this.cache.entries()).map(
            // @ts-expect-error hack to get the value of a Thenable
            ([location, elementThenable]) => [location, elementThenable.value],
          ),
        ),
      })
    })
  }

  private sendToWebSocket(action: string, payload: Record<string, any>) {
    console.log('RscCache::sendToWebSocket action', action, 'payload', payload)

    if (this.socket.readyState === WebSocket?.OPEN) {
      this.sendRetries = 0
      this.socket.send(JSON.stringify({ id: 'rsc-cache-' + action, payload }))
    } else if (
      this.socket.readyState === WebSocket?.CONNECTING &&
      this.sendRetries < 10
    ) {
      const backoff = 300 + this.sendRetries * 100
      setTimeout(() => {
        this.sendRetries++
        this.sendToWebSocket(action, payload)
      }, backoff)
    } else if (this.sendRetries >= 10) {
      console.error('Exhausted retries to send message to WebSocket server.')
    } else {
      console.error('WebSocket connection is closed.')
    }
  }
}
