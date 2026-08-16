import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
  assert.match(stageScript, /sync-routing-suite-preset\.mjs/)
  assert.match(stageScript, /tsc[\s\S]*packages\/host\/frontend-static\/tsconfig\.json/)
  assert.match(stageScript, /tsdown[\s\S]*@deepseek-ai\/dsh-host-frontend-static/)

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
  const staticServerLib = readFileSync(
    join(packagePath('@deepseek-ai/dsh-host-frontend-static'), 'lib', 'index.js'),
    'utf8',
  )
  assert.match(staticServerLib, /['"]\.webp['"]:\s*['"]image\/webp['"]/)

  const frontendAssetRoot = join(frontendRoot, 'dist', 'assets')
  const skinAssetRefs = new Set()
  for (const name of readdirSync(frontendAssetRoot)) {
    if (!name.endsWith('.css')) continue
    const css = readFileSync(join(frontendAssetRoot, name), 'utf8')
    for (const match of css.matchAll(/url\(\s*['"]?(\/assets\/[^\s'")]+)['"]?\s*\)/g)) {
      if (/\.(?:avif|gif|jpe?g|png|webp)(?:\?.*)?$/i.test(match[1])) skinAssetRefs.add(match[1])
    }
  }
  assert.ok(skinAssetRefs.size > 0)
  for (const ref of skinAssetRefs) {
    assert.ok(existsSync(join(frontendRoot, 'dist', ref.slice('/'.length))), `missing staged skin asset ${ref}`)
  }

  const marketplacePackage = 'dsh-plugin-marketplace'
  const webAppPackage = JSON.parse(
    readFileSync(join(packagePath('@deepseek-ai/dsh-web-app'), 'package.json'), 'utf8'),
  )
  assert.equal(typeof webAppPackage.dependencies?.[marketplacePackage], 'string')
  const marketplaceRoot = packagePath(marketplacePackage)
  assert.ok(existsSync(join(marketplaceRoot, 'package.json')))
  assert.ok(existsSync(join(marketplaceRoot, 'lib', 'client.js')))

  const injectorPackage = '@dsh-external/dsh-super-injector'
  const injectorRoot = packagePath(injectorPackage)
  assert.ok(existsSync(join(injectorRoot, 'package.json')))
  assert.ok(existsSync(join(injectorRoot, 'lib', 'index.js')))

  for (const packageName of ['@dsh-extra/im-channel', '@dsh-extra/dsh-client-ui-settings-im']) {
    const packageRoot = packagePath(packageName)
    assert.ok(existsSync(join(packageRoot, 'package.json')))
    assert.ok(existsSync(join(packageRoot, 'lib', 'index.js')))
  }

  const packagedRuntime = join(desktopRoot, 'release', 'win-unpacked', 'resources', 'runtime')
  if (existsSync(packagedRuntime)) {
    assert.ok(existsSync(join(packagedRuntime, 'node_modules', marketplacePackage, 'lib', 'client.js')))
    for (const packageName of ['@dsh-extra/im-channel', '@dsh-extra/dsh-client-ui-settings-im']) {
      assert.ok(existsSync(join(packagedRuntime, 'node_modules', ...packageName.split('/'), 'lib', 'index.js')))
    }
    assert.ok(existsSync(join(packagedRuntime, 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'index.html')))
  }
})
