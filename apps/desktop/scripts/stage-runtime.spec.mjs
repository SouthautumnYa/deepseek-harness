import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const desktopRoot = resolve(import.meta.dirname, '..')
const runtimeRoot = join(desktopRoot, 'runtime')
const runtimeNodeModules = join(runtimeRoot, 'node_modules')
const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
const runtimePackage = JSON.parse(readFileSync(join(runtimeRoot, 'package.json'), 'utf8'))

function packagePath(packageName) {
  return join(runtimeNodeModules, ...packageName.split('/'))
}

test('staged Windows runtime uses the production closure and copies client assets', () => {
  const stageScript = readFileSync(join(desktopRoot, 'scripts', 'stage-runtime.mjs'), 'utf8')
  assert.match(stageScript, /deploy[\s\S]*--filter[\s\S]*@deepseek-ai\/dsh[\s\S]*--prod/)

  const nodeModulesResource = desktopPackage.build.extraResources.find(
    resource => resource.from === 'runtime/node_modules',
  )
  assert.deepEqual(nodeModulesResource?.filter?.[0], '**/*')
  assert.ok(nodeModulesResource?.filter?.includes('!**/*.map'))
  assert.ok(nodeModulesResource?.filter?.includes('!**/*.ts'))

  assert.equal(runtimePackage.name, '@deepseek-ai/dsh')
  assert.equal(runtimePackage.dependencies['@deepseek-ai/dsh-web-app'] !== undefined, true)

  const frontendRoot = packagePath('@deepseek-ai/dsh-web-frontend')
  assert.ok(existsSync(join(frontendRoot, 'dist', 'index.html')))
  assert.ok(existsSync(join(frontendRoot, 'dist', 'assets')))

  const marketplacePackage = 'dsh-plugin-marketplace'
  const webAppPackage = JSON.parse(
    readFileSync(join(packagePath('@deepseek-ai/dsh-web-app'), 'package.json'), 'utf8'),
  )
  assert.equal(typeof webAppPackage.dependencies?.[marketplacePackage], 'string')
  const marketplaceRoot = packagePath(marketplacePackage)
  assert.ok(existsSync(join(marketplaceRoot, 'package.json')))
  assert.ok(existsSync(join(marketplaceRoot, 'lib', 'client.js')))

  const packagedRuntime = join(desktopRoot, 'release', 'win-unpacked', 'resources', 'runtime')
  if (existsSync(packagedRuntime)) {
    assert.ok(existsSync(join(packagedRuntime, 'node_modules', marketplacePackage, 'lib', 'client.js')))
    assert.ok(existsSync(join(packagedRuntime, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')))
  }
})
