import { existsSync } from 'node:fs'

export function loadLocalEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env')
}
