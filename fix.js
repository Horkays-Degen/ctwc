const fs = require('fs');
const p = require('os').homedir() + '/Desktop/ctwc-next/app/api/mint-card/route.ts';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(
  `    const bearerToken = process.env.X_API_BEARER_TOKEN;\n    if (!bearerToken) {\n      return NextResponse.json({ error: "X API not configured" }, { status: 500 });\n    }`,
  `    const bearerToken = process.env.X_API_BEARER_TOKEN;\n    let profile: XProfile;\n    if (!bearerToken) {\n      const seed = handle.split('').reduce((a:number,ch:string)=>a+ch.charCodeAt(0),0);\n      const rand = (min:number,max:number) => min + ((seed*9301+49297)%(max-min));\n      profile = { x_handle:handle, display_name:handle.charAt(0).toUpperCase()+handle.slice(1), avatar_url:'https://unavatar.io/twitter/'+handle, followers:rand(500,250000), following:rand(100,5000), listed_count:rand(10,2000), tweet_count:rand(200,50000), verified:seed%7===0 };\n    } else {`
);
fs.writeFileSync(p, c);
console.log('Done - demo mode enabled!');
