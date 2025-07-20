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

test.todo('args')
test.todo('context')
test.todo('imports')
test.todo('onStart')
test.todo('timeout')
test.todo('kill')
