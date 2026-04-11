const fs = require('fs');
const p = require('os').homedir() + '/Desktop/ctwc-next/components/CTWCApp.tsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(
  '"--dx":`${p.dx}px`, "--dy":`${p.dy}px`, "--rot":`${p.rot}deg`',
  '"--dx" as any:`${p.dx}px`, "--dy" as any:`${p.dy}px`, "--rot" as any:`${p.rot}deg`'
);
fs.writeFileSync(p, c);
console.log('Fixed!');
