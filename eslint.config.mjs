import { config } from 'eslint-config'

export default await config({ ignores: ['dist/', 'examples/'], useJSDoc: true })
