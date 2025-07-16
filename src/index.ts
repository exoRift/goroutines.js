import {
  Worker
} from 'worker_threads'

// Get user's package.json
type Package = typeof import('../package.json')
type Library =
  | (Package extends { dependencies: {} } ? keyof Package['dependencies'] : never)
  | (Package extends { devDependencies: {} } ? keyof Package['devDependencies'] : never)
  | (Package extends { peerDependencies: {} } ? keyof Package['peerDependencies'] : never)
  | (Package extends { optionalDependencies: {} } ? keyof Package['optionalDependencies'] : never)
  | (string & {})
type ImportRecord = {
  [K in Library]?: Array<`default as ${string}` | `* as ${string}` | (string & {}) | `${string} as ${string}`>
}

export function go<T extends (...args: any[]) => void> (fn: T, ctx?: Record<string, any>, imports?: ImportRecord): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
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

  console.debug(statements.join('\n'))

  return (...args) => new Promise((resolve, reject) => {
    const code =
`
import {
  workerData as _jsrWorkerData
} from 'worker_threads'
${statements.join('\n')}

if (_jsrWorkerData.ctx) Object.assign(global, _jsrWorkerData.ctx)

const _jsr = ${fn}

postMessage(await _jsr(..._jsrWorkerData.args))
process.exit(0)
`
    const blob = new Blob([code], { type: 'application/javascript' })
    const worker = new Worker(URL.createObjectURL(blob), {
      workerData: {
        args,
        ctx
      }
    })

    worker.once('message', (m) => resolve(m))
    worker.once('error', (e) => {
      reject(e)
      worker.terminate()
    })
  })
}


