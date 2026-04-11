const fs = require('fs');
const p = require('os').homedir() + '/Desktop/ctwc-next/components/CTWCApp.tsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(
`function transformCard(row: any) {
  return {
    id:          row.id,
    handle:      row.x_handle,
    displayName: row.display_name,
    avatarUrl:   row.avatar_url,
    ovr:         row.ovr,
    tier:        row.tier,
    stats:       row.stats || {},
    badges:      row.badges || [],
    teamId:      row.team_id,
    position:    row.position,
    rawProfile: {
      followers:    row.followers,
      followingCount: row.following,
      listedCount:  row.listed_count,
      tweetCount:   row.tweet_count,
      verified:     row.verified,
    },
  };
}`,
`function transformCard(row: any) {
  return {
    id:          row.id || '',
    handle:      row.x_handle || '',
    displayName: row.display_name || row.x_handle || 'CT Player',
    avatarUrl:   row.avatar_url || '',
    ovr:         row.ovr || 60,
    tier:        row.tier || 'CT Player',
    stats:       row.stats || { ENG:60, INF:60, CLT:60, VOL:60, VRL:60, OVR:60 },
    badges:      row.badges || [],
    teamId:      row.team_id || null,
    position:    row.position || null,
    rawProfile: {
      followers:    row.followers || 0,
      followingCount: row.following || 0,
      listedCount:  row.listed_count || 0,
      tweetCount:   row.tweet_count || 0,
      verified:     row.verified || false,
    },
  };
}`
);
fs.writeFileSync(p, c);
console.log('Fixed!');
