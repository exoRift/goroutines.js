import { writeFileSync, existsSync } from 'fs' // Node
import { tmpdir } from 'os' // Node
import { createHash } from 'crypto' // Node
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

type CoRoutine<T extends (...args: any) => any> =
  (...args: Parameters<T>) => ReturnType<T> extends Generator<infer U, infer R, infer N> | AsyncGenerator<infer U, infer R, infer N>
    ? AsyncGenerator<U, R, N>
    : Promise<Awaited<ReturnType<T>>>

/**
 * Create a jsroutine (co-routine) function that runs on another thread
 * @see https://github.com/exoRift/js-routine
 * @param fn      The function
 * @param ctx     Global variables to be defined for the subprocess
 * @param imports Packages/files to import. { [PACKAGE_NAME]: [...IMPORTS] }
 * @example
 * { // Anything can be renamed using `as`. `*` collects all named exports. `default` is the default export \
 *   fs: ['default as fs'], \
 *   echarts: ['* as echarts'], \
 *   express: ['default as express', 'Router', 'json'] \
 * }
 * @param kill    An abort signal to kill the process
 * @returns       A callable jsroutine function
 */
export function go<T extends (...args: any) => void> (fn: T, ctx?: Record<string, any> | null, imports?: ImportRecord | null, kill?: AbortSignal | null): CoRoutine<T> {
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

  let objURL
  if (typeof Bun === 'undefined') {
    const hash = createHash('sha1').update(code).digest('hex')
    objURL = `${tmpdir()}/${hash}.js`
    const exists = existsSync(objURL)
    if (!exists) writeFileSync(objURL, code, { encoding: 'utf-8' })
  } else {
    const blob = new Blob([code], { type: 'application/javascript' })
    objURL = URL.createObjectURL(blob)
  }

  if (isGenerator) {
    // @ts-expect-error
    return async function * _jsrExecuteGenerator (...args) {
      kill?.throwIfAborted()

      const worker = new Worker(objURL, {
        name: 'test',
        workerData: {
          args,
          ctx
        }
      })

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const ret = await getPromisedMessage<{ done: boolean, value: any }>(worker)
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
          kill?.throwIfAborted()
        } catch (err) {
          reject(err)
          return
        }

        const worker = new Worker(objURL, {
          workerData: {
            args,
            ctx
          }
        })

        kill?.addEventListener('abort', () => {
          void worker.terminate()
          try {
            kill.throwIfAborted()
          } catch (err) {
            reject(err)
          }
        }, { once: true, passive: true })

        worker.once('message', (m) => {
          terminated = true
          resolve(m)
        })
        worker.once('error', (e) => {
          terminated = true
          reject(e)
          void worker.terminate()
        })
        worker.once('exit', (exitCode) => {
          if (terminated) return
          reject(new Error(`Process exited with code: ${exitCode}`))
        })
      })
    }
  }
}
