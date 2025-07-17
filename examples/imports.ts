import { go } from '../src'

const CRIME_SCENE = 'The Museum'
const CRIME_DATE = '2025-07-17T20:03:11.952Z'

interface Suspect {
  name: string
  locations: Record<string, string>
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
  // Due to the behavior of the worker api, relative modules are usually resolved from the CWD, not the file directory. Bun exposes an API for module location resolution
  // [Bun.resolveSync('./suspects.json', import.meta.dirname)]: ['default as suspects'],
  util: ['styleText']
})()
console.log(suspect)
