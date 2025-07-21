import {
  Worker
} from 'worker_threads'

/* eslint-disable */
// Get user's package.json
type Package = typeof import('../package.json')
type Library =
  | (Package extends { dependencies: {} } ? keyof Package['dependencies'] : (string & {}))
  | (Package extends { devDependencies: {} } ? keyof Package['devDependencies'] : (string & {}))
  | (Package extends { peerDependencies: {} } ? keyof Package['peerDependencies'] : (string & {}))
  | (string & {})
type ImportRecord = Partial<Record<Library, Array<`default as ${string}` | `* as ${string}` | (string & {}) | `${string} as ${string}`>>>
/* eslint-enable */

/**
 * Get the next event from a worker as a promised value
 * @param worker The worker
 * @returns      The event value
 */
function getPromisedMessage<T> (worker: Worker): Promise<T> {
  return new Promise((resolve, reject) => {
    function onMessage (m: any): void {
      cleanup()
      resolve(m)
    }
    function onError (e?: any): void {
      cleanup()
      reject(e)
      void worker.terminate()
    }
    function onExit (exitCode: number): void {
      cleanup()
      reject(new Error(`Process exited with code: ${exitCode}`))
    }
    function cleanup (): void {
      worker.removeListener('message', onMessage)
      worker.removeListener('error', onError)
      worker.removeListener('exit', onExit)
    }

    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
  })
}

type Goroutine<T extends (...args: any) => any> =
  (...args: Parameters<T>) => ReturnType<T> extends Generator<infer U, infer R, infer N> | AsyncGenerator<infer U, infer R, infer N>
    ? AsyncGenerator<U, R, N>
    : Promise<Awaited<ReturnType<T>>>

interface GoroutineOptions {
  /** An abort signal to kill the process */
  signal?: AbortSignal
  /**
   * A callback called after the worker has been created
   * @warn Posting messages can lead to unexpected behavior
   * @warn Expensive/slow operations can lead to unexpected behavior. If necessary and able, make function async
   */
  onStart?: (worker: Worker) => void | Promise<void>
  /** A timeout that will kill the process if not completed within the time (resets on `.next()` for generators) */
  timeoutMs?: number
}

/**
 * Create a goroutine function that runs on another thread
 * @see https://github.com/exoRift/goroutines.js
 * @param fn      The function
 * @note Both synchronous and asynchronous functions can be used. The return value will always be a promise.
 * @note Synchronous and asynchronous generators can also be used which will return async generator values. This is useful for data streaming
 * @param ctx     Global variables to be defined for the subprocess
 * @param imports Packages/files to import. `{ [PACKAGE_NAME]: [...IMPORTS] }`
 * @example
 * { // Anything can be renamed using `as`. `*` collects all named exports. `default` is the default export
 *   fs: ['default as fs'],
 *   echarts: ['* as echarts'], // import echarts from 'echarts'
 *   express: ['default as express', 'Router', 'json as parseJson'] // import express, { router, json as parseJson } from 'express'
 * }
 * @param options Additional goroutine options
 * @returns       A callable goroutine function
 */
export function go<T extends (...args: any) => void> (fn: T, ctx?: Record<string, any> | null, imports?: ImportRecord | null, options?: GoroutineOptions | null): Goroutine<T> {
  const isGenerator = ['GeneratorFunction', 'AsyncGeneratorFunction'].includes(fn.constructor.name)

  const statements = imports
    ? Object.entries(imports).map(([pkg, exps]) => {
      if (!exps) return ''
      let unnamed: [string, string | undefined] | undefined
      const named = []

      for (const exp of exps) {
        const [original, rename] = exp.split(' as ')
        if (original === 'default' || original === '*') unnamed = [original, rename]
        else named.push(exp)
      }

      let str = 'import '
      if (unnamed) {
        if (unnamed[0] === '*') str += unnamed[0]
        if (unnamed[1]) {
          if (unnamed[0] !== 'default') str += ' as '
          str += unnamed[1]
        }

        if (named.length) str += ', '
      }

      if (named.length) {
        str += '{ '
        str += named.join(', ')
        str += ' }'
      }
      if (unnamed || named.length) str += ' from'
      str += ` '${pkg}'`
      if (pkg.endsWith('.json')) str += ' with { type: \'json\' }'

      return str
    })
    : []

  const handleRetCode = isGenerator
    ? `
function _jsrWaitForMessage () {
  return new Promise((resolve) => _jsrParentPort.once('message', resolve))
}

(async () => {
  const _jsrIter = _jsr(..._jsrWorkerData.args)
  let _jsrChunk
  let _jsrLastResponse

  do {
    _jsrChunk = await _jsrIter.next(_jsrLastResponse)
    _jsrParentPort.postMessage(_jsrChunk)
    if (_jsrChunk.done) break

    _jsrLastResponse = await _jsrWaitForMessage()
  } while (!_jsrChunk?.done)

  process.exit(0)
})()

setInterval(() => {}, 1 << 30) // keep event loop alive
`
    : `
_jsrParentPort.postMessage(await _jsr(..._jsrWorkerData.args))
process.exit(0)
`

  const code =
`
import {
  workerData as _jsrWorkerData,
  parentPort as _jsrParentPort
} from 'worker_threads'
${statements.join('\n')}

if (_jsrWorkerData.ctx) Object.assign(global, _jsrWorkerData.ctx)

const _jsr = ${fn.toString()}

${handleRetCode}
`

  if (isGenerator) {
    // @ts-expect-error
    return async function* _jsrExecuteGenerator (...args) {
      options?.signal?.throwIfAborted()

      const worker = new Worker(code, {
        eval: true,
        workerData: {
          args,
          ctx
        }
      })
      void options?.onStart?.(worker)

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const timeout = options?.timeoutMs
          ? setTimeout(() => {
            worker.emit('error', new Error('Thread exceeded timeout'))
            void worker.terminate()
          }, options.timeoutMs)
          : undefined
        const ret = await getPromisedMessage<{ done: boolean, value: any }>(worker)
        clearTimeout(timeout)
        if (ret.done) return ret.value
        else {
          // @ts-expect-error
          const response = yield ret.value
          worker.postMessage(response)
        }
      }
    }
  } else {
    // @ts-expect-error
    return function _jsrExecute (...args) {
      return new Promise((resolve, reject) => {
        let terminated = false
        try {
          options?.signal?.throwIfAborted()
        } catch (err) {
          reject(err)
          return
        }

        const worker = new Worker(code, {
          eval: true,
          workerData: {
            args,
            ctx
          }
        })
        void options?.onStart?.(worker)

        const timeout = options?.timeoutMs
          ? setTimeout(() => {
            reject(new Error('Thread exceeded timeout'))
            terminated = true
            void worker.terminate()
          }, options.timeoutMs)
          : undefined

        options?.signal?.addEventListener('abort', () => {
          void worker.terminate()
          try {
            options.signal?.throwIfAborted()
          } catch (err) {
            reject(err)
          }
        }, { once: true, passive: true })

        worker.once('message', (m) => {
          if (timeout) clearTimeout(timeout)
          terminated = true
          resolve(m)
        })
        worker.once('error', (e) => {
          if (timeout) clearTimeout(timeout)
          terminated = true
          reject(e)
          void worker.terminate()
        })
        worker.once('exit', (exitCode) => {
          if (terminated) return
          if (timeout) clearTimeout(timeout)
          reject(new Error(`Process exited with code: ${exitCode}`))
        })
      })
    }
  }
}
