# Goroutines.js

Inspired by Go's [Goroutines](https://go.dev/tour/concurrency/1), this package adds an easy ability to trivially multithread (and potentially multiprocess) your code (supports NodeJS and Bun)

### Note about concurrency
Concurrency is a difficult thing to get right that should only be applied in circumstances where it's warranted. It's not recommended to use it for simple operations due to the bootstrap time of using workers. Be sure to benchmark your code using concurrency vs single-threaded.

Be sure to also avoid fork-bombing. Most runtimes are optimized for recursion so expensive recursive functions should be run in their entirety on a thread, rather than running each recursion on its own thread (which can lead to a segfault)

## Installation
```
npm install goroutines
```

## Getting Started
Take a costly function,
```ts
function fib (n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}

const result = fib(40)
console.log(resut)
```

This is a heavy function that blocks the event loop. It can be made asynchronous with the `async`, but still runs on the same thread (JS is single-threaded) which can be taxing.

Instead, wrap it into a goroutine
```ts
import { go } from 'goroutines'

const result = await go(fib)(40)
console.log(result)
```

The function will now run on a separate thread, leaving your main process unblocked
> [!IMPORTANT]
> Technically, we're still blocking the main thread in this example with a top-level await.
> Make sure to read into how [promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) work

## Data Streaming
Another useful capability of Goroutines is their ability to stream data. You can accomplish something similar using [generator functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator).

```ts
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
```
> [!NOTE]
> If this function seems confusing, `yield` functions as a return without actually ending the function and `iter.next()` receives that value.

This will function exactly like an async generator.

> [!TIP]
> A regular array can be serialized just as well but results in cloning which is costly.
>
> See: [Supported data types](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm#javascript_types)
>
> See: [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)

You can iterate through it using the `for await` syntax
```ts
for await (const chunk of go(getEven)(shared)) { ... }
```

You can pass data back to the thread
```ts
// Dramatized example for demonstration. DO NOT DO THIS
function* pwValidator (password: string) {
  while (true) {
    const attempt = yield 'Enter a password'
    if (attempt === password) {
      yield 'Correct!'
      break
    } else yield 'Incorrect!'
  }
}

const guesser = go(pwValidator)('super secret password')
await guesser.next()

const guess = 'wrong password'
const result = await guesser.next(guess)
console.log(result.value)
```
> [!TIP]
> You can read more into the specifics of how generator functions pass values between yields [here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Generator)

## Context and Imports
If your function uses an out-of-scope variable, you can pass it to your goroutine via the context parameter

```ts
import suspectdata from './suspects.json' with { type: 'json' }

const CRIME_SCENE = 'The Museum'
const CRIME_DATE = '2025-07-17T20:03:11.952Z'

interface Suspect {
  name: string
  locations: Partial<Record<string, string>>
}

const suspects: Suspect[] = suspectdata

function findPerp () {
  return suspects.find((s) => s.locations[CRIME_DATE] === CRIME_SCENE)?.name
}

const suspect = await go(findPerp, {
  CRIME_SCENE,
  CRIME_DATE,
  suspects
})()
console.log(suspect)
```

Firstly, notice an optimization we can do. Instead of importing the data here and passing it to the worker, we can import it directly into the worker.

Secondly, simply logging the suspect isn't enough. We must show them for who they are in all of their evil glory. To accomplish this, we'll style the text red using `styleText` from `'util'`

```ts
const CRIME_SCENE = 'The Museum'
const CRIME_DATE = '2025-07-17T20:03:11.952Z'

interface Suspect {
  name: string
  locations: Partial<Record<string, string>>
}

function findPerp () {
  // @ts-expect-error
  declare const suspects: Suspect[]
  // @ts-expect-error
  declare const styleText: typeof import('util').styleText

  const name = suspects.find((s) => s.locations[CRIME_DATE] === CRIME_SCENE)?.name
  return name && styleText('red', name)
}

const suspect = await go(findPerp, {
  CRIME_SCENE,
  CRIME_DATE
}, {
  './suspects.json': ['default as suspects'],
  // Due to the behavior of the worker api, relative modules are usually resolved from the CWD, not the file directory. Bun exposes an API for module location resolution:
  // [Bun.resolveSync('./suspects.json', import.meta.dirname)]: ['default as suspects'],
  util: ['styleText']
})()
console.log(suspect)
```
> [!CAUTION]
> Try to avoid passing large amounts of data to workers via context, function call parameters, or generator passing
> If the dataset already exists in a file and isn't required in the main thread, import it in the goroutine.