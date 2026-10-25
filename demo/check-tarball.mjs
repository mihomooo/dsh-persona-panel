import fs from 'node:fs';

const dir = process.argv[2];
const src = fs.readFileSync(`${dir}/client.js`, 'utf8');

const marks = [
  ['module loader', '__ModuleLoader__.load'],
  ['slots inject', "inject:['slots']"],
  ['settings.section', "'settings.section'"],
  ['sidebar.panellist', "'sidebar.panellist'"],
  ['shell.overlay', "'shell.overlay'"],
  ['fetch api', '/persona-panel/api'],
];
for (const [label, needle] of marks) {
  console.log(`${label.padEnd(18)} ${src.includes(needle) ? 'ok' : 'MISSING'}`);
}
console.log('bytes', src.length);
