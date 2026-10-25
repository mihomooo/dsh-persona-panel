import fs from 'node:fs'

// Checks an unpacked tarball (or this repo) for the pieces the panel needs at
// runtime. Exits 1 when something is missing: a checker that only prints is a
// checker nobody reads.
const dir = process.argv[2] || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const src = fs.readFileSync(`${dir}/client.js`, 'utf8')
const pkg = JSON.parse(fs.readFileSync(`${dir}/package.json`, 'utf8'))

const marks = [
  ['module loader', '__ModuleLoader__.load'],
  ['slots inject', "inject: ['slots']"],
  ['settings.section', "'settings.section'"],
  ['sidebar.panellist', "'sidebar.panellist'"],
  ['shell.overlay', "'shell.overlay'"],
  ['fetch api', '/persona-panel/api'],
  ['diary tab', "TITLES"],
  ['others panel', "Others"],
]

let bad = 0
for (const [label, needle] of marks) {
  const ok = src.includes(needle)
  if (!ok) bad++
  console.log(`${label.padEnd(18)} ${ok ? 'ok' : 'MISSING'}`)
}

const manifest = [
  ['bundle manifest', !!pkg.dsh?.bundle],
  ['client platform', pkg.dsh?.client?.platform === 'web'],
  ['main file', fs.existsSync(`${dir}/${pkg.main || 'index.js'}`)],
  ['screenshot', fs.existsSync(`${dir}/screenshot.png`)],
]
for (const [label, ok] of manifest) {
  if (!ok) bad++
  console.log(`${label.padEnd(18)} ${ok ? 'ok' : 'MISSING'}`)
}

console.log(`version           ${pkg.version}`)
console.log(`client.js         ${src.length} chars`)
process.exit(bad ? 1 : 0)
