import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const FEEDS = [
  'https://eu.forums.blizzard.com/en/wow/c/wow-forever/wow-forever-general-discussion/360.rss',
  'https://eu.forums.blizzard.com/en/wow/t/pvp-faction-balance-updates-11-november/641169.rss',
  'https://eu.forums.blizzard.com/en/wow/u/Kaivax/activity.rss',
  'https://eu.forums.blizzard.com/en/wow/u/Aggrend/activity.rss',
  'https://www.reddit.com/r/wowforever/new/.rss',
  'https://www.reddit.com/r/wowforever/comments/.rss',
];
const HOUR = 3600000;
export function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:lt|gt|quot|apos|amp|#\d+|#x[\da-f]+);/gi, x => {
      const named = {'&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&amp;':'&'};
      if (named[x]) return named[x];
      const n = x.startsWith('&#x') ? parseInt(x.slice(3),16) : parseInt(x.slice(2),10);
      return Number.isInteger(n) && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    });
}
function field(block, tag) {
  return decode(block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] || '');
}
export function text(html) {
  return html.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseFeed(xml, source) {
  if (!/<(?:rss|feed)\b/i.test(xml) || !/<\/(?:rss|feed)>/i.test(xml)) throw Error('Invalid RSS/Atom response');
  const rows = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return rows.map(([, , b]) => {
    const href = b.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    const url = href ? decode(href) : field(b,'link');
    const authorBlock = field(b,'author');
    const author = field(authorBlock,'name') || field(b,'dc:creator') || text(authorBlock);
    return {id: field(b,'id') || field(b,'guid') || url, url,
      title: text(field(b,'title')), body: text(field(b,'content') || field(b,'description') || field(b,'summary')),
      author, date: Date.parse(field(b,'published') || field(b,'pubDate') || field(b,'updated')), source};
  });
}

// Conservative text matching, not an AI or authoritative availability check.
export function candidate(item, now = Date.now()) {
  if (!Number.isFinite(item.date) || now-item.date > HOUR || item.date > now+300000) return false;
  if (!item.author || !/^https:\/\/(?:eu\.forums\.blizzard\.com|(?:www\.)?reddit\.com)\//.test(item.url)) return false;
  const s = `${item.title} ${item.body}`.toLowerCase();
  if (!/\b(eu|europe|european)\b/.test(s) || !/\bpvp\b/.test(s) || !/\bhorde\b/.test(s)) return false;
  if (/\b(na|north america|rppvp|rp[ -]pvp|pvp[ -]rp|pve)\b/.test(s)) return false;
  if (/\b(yesterday|last week|last night|days ago)\b/.test(item.body.toLowerCase())) return false;
  // Require an explicit FIRST-character success in the author's own prose.
  return /\bi (?:have |just |finally |successfully |was (?:just |finally )?able to )*(?:created?|made|make)\b[^.!?]{0,100}\b(?:my )?first\b[^.!?]{0,60}\bhorde\b/i.test(item.body)
    && !/\b(?:couldn.t|cannot|can.t|unable to|not able to|haven.t|have not|didn.t|did not)\b/i.test(item.body);
}
export function newEvidence(items, state, now = Date.now()) {
  const unique = new Map();
  for (const item of items.filter(i=>candidate(i,now))) {
    const key = `${new URL(item.url).hostname.replace(/^www\./,'')}:${item.author.toLowerCase()}`;
    if (!unique.has(key) || unique.get(key).date < item.date) unique.set(key,item);
  }
  const fresh = [...unique.values()].filter(i=>!state.alerted?.[i.id]);
  // Two authors from public sources, with at least one not previously alerted.
  return unique.size >= 2 && fresh.length ? [...unique.values()] : [];
}
export function staffStatement(item, now=Date.now()) {
  if (!Number.isFinite(item.date) || now-item.date>HOUR || item.date>now+300000) return false;
  if (!/^https:\/\/eu\.forums\.blizzard\.com\//.test(item.url)) return false;
  if (!/^(Kaivax|Aggrend)$/i.test(item.author)) return false;
  const s=`${item.title} ${item.body}`;
  return /\b(?:EU|Europe|European)\b/i.test(s) && /\bPvP\b/i.test(s) && /\bHorde\b/i.test(s)
    && !/\b(?:NA|North America|RP[ -]?PvP|PvP[ -]RP|PvE|not|never)\b/i.test(s)
    && /\b(?:(?:character )?creation (?:is|has been) (?:now )?(?:enabled|reopened|unlocked)|(?:now|currently) (?:open|enabled|unlocked))\b/i.test(s);
}
async function request(url, options={}) {
  const r = await fetch(url, {signal:AbortSignal.timeout(20000), ...options});
  if (!r.ok) throw Error(`HTTP ${r.status} from ${new URL(url).hostname}`);
  return r;
}
export async function push(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic || !/^[\w-]+$/.test(topic)) throw Error('NTFY_TOPIC is missing or invalid');
  const headers = {'Title':title,'Priority':'high','Tags':'bell','Content-Type':'text/plain; charset=utf-8'};
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  await request(`https://ntfy.sh/${topic}`, {method:'POST',headers,body:message});
}
async function stateStore() {
  if (!process.env.GITHUB_ACTIONS) {
    const file = process.env.MONITOR_STATE || '.monitor-state.json';
    let state = {};
    try {state=JSON.parse(await readFile(file,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
    return {state, save:async()=>writeFile(file, JSON.stringify(state))};
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw Error('Invalid repository');
  const headers = {'Authorization':`Bearer ${process.env.GH_TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const api = async (path, options={}) => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {headers,signal:AbortSignal.timeout(20000),...options});
    if (!r.ok && r.status!==404) throw Error(`GitHub state HTTP ${r.status}`);
    return r;
  };
  let branch = await api('git/ref/heads/monitor-state');
  if (branch.status===404) {
    const meta = await (await api('')).json();
    const ref = await (await api(`git/ref/heads/${encodeURIComponent(meta.default_branch)}`)).json();
    await api('git/refs', {method:'POST',body:JSON.stringify({ref:'refs/heads/monitor-state',sha:ref.object.sha})});
  }
  let sha;
  let state = {};
  const r = await api('contents/monitor-state.json?ref=monitor-state');
  if (r.ok) {const data=await r.json(); sha=data.sha; state=JSON.parse(Buffer.from(data.content,'base64').toString());}
  return {state, save:async()=>{
    const result = await api('contents/monitor-state.json', {method:'PUT',body:JSON.stringify({
      message:'Update monitor state [skip ci]',branch:'monitor-state',sha,
      content:Buffer.from(JSON.stringify(state)).toString('base64')})});
    const data=await result.json(); sha=data.content.sha;
  }};
}
export async function main() {
  if (process.argv.includes('--probe')) {
    for (const source of FEEDS) {
      try {
        const r=await request(source,{headers:{'User-Agent':'WoW-Reopening-Watcher/1.0 (RSS reader)'}});
        const rows=parseFeed(await r.text(),source);
        console.log(JSON.stringify({source,ok:true,items:rows.length}));
      } catch(e) {console.log(JSON.stringify({source,ok:false,error:e.message})); process.exitCode=1;}
    }
    return;
  }
  if (process.argv.includes('--test-push')) {
    await push('TEST ONLY - GitHub WoW monitor', 'TEST ONLY: Sent by the GitHub cloud runner. This is not a Horde reopening alert.');
    console.log('Test push accepted by ntfy.'); return;
  }
  const store = await stateStore();
  const state = store.state;
  const now = Date.now();
  if (state.lastCheck && now-state.lastCheck < 300000) {console.log('SKIP: Check interval already reserved.'); return;}
  state.lastCheck = now;
  await store.save(); // Reserve BEFORE accessing sources. No replay loop.
  const results = await Promise.allSettled(FEEDS.map(async source=>{
    const r=await request(source, {headers:{'User-Agent':'WoW-Reopening-Watcher/1.0 (RSS reader)','Accept':'application/rss+xml, application/atom+xml, text/xml'}});
    const xml=await r.text(); if(xml.length>2000000) throw Error('Feed exceeded size limit');
    return parseFeed(xml,source);
  }));
  const items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  const errors=results.flatMap((r,i)=>r.status==='rejected'?[`${new URL(FEEDS[i]).hostname}: ${r.reason.message}`]:[]);
  const errorKey=errors.join('; ');
  if (errors.length) {
    if (state.failure!==errorKey || now-(state.failureAt||0)>=HOUR) {
      await push('MONITOR CHECK FAILED - WoW', `Monitoring coverage is incomplete. ${errorKey}. Inspect GitHub Actions. This is NOT a reopening alert.`);
      state.failureAt=now;
    }
    state.failure=errorKey;
  } else if (state.failure) {
    await push('WoW monitor recovered','All configured RSS sources are accessible again. This is NOT a reopening alert.');
    delete state.failure; delete state.failureAt;
  }
  state.recent = [...(state.recent||[]), ...items.filter(i=>candidate(i,now))].filter(i=>now-i.date<=HOUR);
  const evidence=newEvidence(state.recent,state,now);
  const staff=items.filter(i=>staffStatement(i,now) && !state.alerted?.[i.id]);
  if(staff.length) {
    await push('EU PvP Horde - Blizzard post', `A known Blizzard forum account posted a possible EU PvP Horde reopening statement. Automated text matching; read the source to confirm current availability.\n\n${staff.map(i=>`${i.author}: ${i.body.slice(0,350)}\n${i.url}`).join('\n\n')}`);
    state.alerted ||= {};
    for(const i of staff) state.alerted[i.id]=now;
  }
  if(evidence.length) {
    const lines=evidence.map(i=>`${i.author}: ${i.body.slice(0,300)}\n${i.url}`);
    await push('POSSIBLE EU PvP Horde opening', `UNCONFIRMED: Two authors report first Horde creation on EU PvP within the last hour. Automated text matching; verify the linked reports. Openings may close quickly.\n\n${lines.join('\n\n')}`);
    state.alerted ||= {};
    for(const i of evidence) state.alerted[i.id]=now;
  }
  state.alerted=Object.fromEntries(Object.entries(state.alerted||{}).filter(([,t])=>now-t<86400000));
  await store.save();
  console.log(JSON.stringify({checkedAt:new Date(now).toISOString(),items:items.length,sourceFailures:errors.length,evidence:evidence.length}));
  if (errors.length) process.exitCode=1;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(async e=>{
    console.error(`MONITOR CHECK FAILED: ${e.message}`);
    try {await push('MONITOR CHECK FAILED - WoW', `The cloud check could not complete: ${e.message}. Inspect GitHub Actions. This is NOT a reopening alert.`);} catch {console.error('ntfy failure alert also failed; inspect GitHub Actions notifications.');}
    process.exitCode=1;
  });
}
