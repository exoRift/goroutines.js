import { go } from '../src'

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
process.exit(0)
