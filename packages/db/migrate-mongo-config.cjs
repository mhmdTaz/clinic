/* eslint-disable no-undef */
// migrate-mongo runs outside the app, so it reads the environment directly.
// This is the documented exception to the "only @clinic/config reads process.env" rule.
const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

const uri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB

if (!uri || !databaseName) {
  throw new Error(
    'MONGODB_URI and MONGODB_DB must be set before running migrations. ' +
      'Copy .env.example to .env at the repository root.',
  )
}

module.exports = {
  mongodb: {
    url: uri,
    databaseName,
    options: { serverSelectionTimeoutMS: 10000 },
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'migrations',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'esm',
}
