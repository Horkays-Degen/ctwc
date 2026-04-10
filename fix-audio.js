const fs = require('fs');
const p = require('os').homedir() + '/Desktop/ctwc-next/components/CTWCApp.tsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(
  'new (window.AudioContext || window.webkitAudioContext)()',
  'new (window.AudioContext || (window as any).webkitAudioContext)()'
);
fs.writeFileSync(p, c);
console.log('Fixed!');
