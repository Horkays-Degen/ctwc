const fs = require('fs');
const p = require('os').homedir() + '/Desktop/ctwc-next/components/CTWCApp.tsx';
let c = fs.readFileSync(p, 'utf8');

// Revert the bad fix first
c = c.replace(/\"--dx\" as any:/g, '"--dx":');
c = c.replace(/\"--dy\" as any:/g, '"--dy":');
c = c.replace(/\"--rot\" as any:/g, '"--rot":');

// Now cast the whole style object properly
c = c.replace(
  `"--dx":\`\${p.dx}px\`, "--dy":\`\${p.dy}px\`, "--rot":\`\${p.rot}deg\`,
              pointerEvents:"none",
            }}/>`,
  `"--dx":\`\${p.dx}px\`, "--dy":\`\${p.dy}px\`, "--rot":\`\${p.rot}deg\`,
              pointerEvents:"none",
            } as any}/>` 
);

fs.writeFileSync(p, c);
console.log('Fixed!');
