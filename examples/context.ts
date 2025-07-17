import { go } from '../src'
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
