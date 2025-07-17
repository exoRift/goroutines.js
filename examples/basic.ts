import { go } from '../src'

function fib (n: number): number {
  if (n <= 1) return n
  return fib(n - 1) + fib(n - 2)
}

const result = await go(fib)(40)
console.log(result)
