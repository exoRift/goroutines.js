/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { test, expect } from 'bun:test'

import { go } from '../src'

test('sync function', async () => {
  function foo () {
    return 'bar'
  }

  expect(await go(foo)()).toBe('bar')
})

test('async function', async () => {
  async function foo () {
    return 'bar'
  }

  expect(await go(foo)()).toBe('bar')
})

test('sync generator', async () => {
  function* foo () {
    yield 'bar'
    yield 'baz'
    return 'foobar'
  }

  const iter = go(foo)()
  expect(await iter.next()).toEqual({ value: 'bar', done: false })
  expect(await iter.next()).toEqual({ value: 'baz', done: false })
  expect(await iter.next()).toEqual({ value: 'foobar', done: true })
})

test('async generator', async () => {
  async function* foo () {
    yield 'bar'
    yield 'baz'
    return 'foobar'
  }

  const iter = go(foo)()
  expect(await iter.next()).toEqual({ value: 'bar', done: false })
  expect(await iter.next()).toEqual({ value: 'baz', done: false })
  expect(await iter.next()).toEqual({ value: 'foobar', done: true })
})

test('args', async () => {
  function foo ({ a, b }: { a: string, b: string }) {
    return a + b
  }

  expect(await go(foo)({ a: 'foo', b: 'bar' })).toEqual('foobar')
})

test('generator i/o', async () => {
  function* foo () {
    const a: string = yield 'a'
    const b: string = yield a + 'b'
    const c: string = yield b + 'c'
    return c + 'd'
  }

  const iter = go(foo)()
  expect(await iter.next()).toEqual({ value: 'a', done: false })
  expect(await iter.next('b')).toEqual({ value: 'bb', done: false })
  expect(await iter.next('c')).toEqual({ value: 'cc', done: false })
  expect(await iter.next('d')).toEqual({ value: 'dd', done: true })
})

test('context', async () => {
  const bar = 'baz'

  function foo () {
    return bar
  }

  expect(await go(foo, { bar })()).toBe('baz')
})

test('imports', async () => {
  function foo () {
    // @ts-expect-error
    declare const os: typeof import('os') // eslint-disable-line @typescript-eslint/consistent-type-imports
    return os.arch()
  }

  function bar () {
    // @ts-expect-error
    declare const arch: typeof import('os')['arch'] // eslint-disable-line @typescript-eslint/consistent-type-imports
    return arch()
  }

  function barb () {
    // @ts-expect-error
    declare const archb: typeof import('os')['arch'] // eslint-disable-line @typescript-eslint/consistent-type-imports
    return archb()
  }

  expect(await go(foo, null, { os: ['default as os'] })(), 'default').toBe((await import('os')).arch())
  expect(await go(foo, null, { os: ['* as os'] })(), 'collect').toBe((await import('os')).arch())
  expect(await go(bar, null, { os: ['arch'] })(), 'named').toBe((await import('os')).arch())
  expect(await go(barb, null, { os: ['arch as archb'] })(), 'renamed named').toBe((await import('os')).arch())
})

test('onStart', async () => {
  async function foo () {
    await Bun.sleep(200)
    return 'bar'
  }

  expect(() => go(foo, null, null, { onStart: (worker) => { void Bun.sleep(100).then(() => worker.emit('exit', 124)) } })()).toThrow('Process exited with code: 124')
})

test('timeout', async () => {
  async function foo () {
    await Bun.sleep(400)
    return 'bar'
  }

  expect(() => go(foo, null, null, { timeoutMs: 200 })()).toThrow('Thread exceeded timeout')
})

test('generator timeout', async () => {
  async function* foo () {
    await Bun.sleep(100)
    yield 'bar'
    await Bun.sleep(250)
    yield 'baz'
    await Bun.sleep(400)
    yield 'foobar'
  }

  const iter = go(foo, null, null, { timeoutMs: 300 })()
  expect(() => iter.next()).not.toThrow()
  expect(() => iter.next()).not.toThrow()
  expect(() => iter.next()).toThrow('Thread exceeded timeout')
})

test('kill', async () => {
  async function foo () {
    await Bun.sleep(500)
    return 'bar'
  }

  const aborter = new AbortController()
  const fn1 = () => {
    const promise = go(foo, null, null, { signal: aborter.signal })()
    aborter.abort()
    return promise
  }
  expect(fn1, 'after').toThrow('The operation was aborted.')
  const fn2 = () => go(foo, null, null, { signal: aborter.signal })()
  expect(fn2, 'before').toThrow('The operation was aborted.')
})
