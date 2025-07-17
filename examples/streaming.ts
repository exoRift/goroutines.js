import { go } from '../src'

const shared = new SharedArrayBuffer(1_000_000)
const array = new Uint8Array(shared)
crypto.getRandomValues(array)

function* getEven(buffer: SharedArrayBuffer) {
  const data = new Uint8Array(buffer)
  for (let i = 0; i < data.length; ++i) {
    const value = Atomics.load(data, i)
    if (!(value % 2)) yield value
  }
}

const iter = go(getEven)(shared)
let ret
do {
  ret = await iter.next()
  if (ret.done) break

  console.log(ret.value)
} while (!ret.done)
