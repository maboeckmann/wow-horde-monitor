import test from 'node:test';
import assert from 'node:assert/strict';
import {candidate,newEvidence,parseFeed,staffStatement,stateStore,main,FEEDS,recordHealth,notifyHealth} from './monitor.mjs';
// No fixture may reach a real feed or notification topic, including in CI.
globalThis.fetch = async () => {throw Error('Network disabled in tests');};
const now=Date.now();
const make=(overrides={})=>({id:'a',author:'one',title:'EU PvP Horde',body:'I just created my first Horde character on EU PvP.',url:'https://www.reddit.com/r/wowforever/comments/a/',date:now,...overrides});
test('explicit recent first-character EU PvP success is a candidate',()=>assert.equal(candidate(make(),now),true));
test('staff statements require a known account, EU scope, and current reopening language',()=>{
  const item=make({author:'Kaivax',url:'https://eu.forums.blizzard.com/en/wow/t/a/1',body:'Horde character creation is now enabled on EU PvP.'});
  assert.equal(staffStatement(item,now),true);
  assert.equal(staffStatement({...item,author:'someone'},now),false);
  assert.equal(staffStatement({...item,body:'Horde character creation is not enabled on EU PvP.'},now),false);
  assert.equal(staffStatement({...item,body:'We will reopen Horde character creation on EU PvP.'},now),false);
});
test('rejects wrong region/ruleset, stale, negative and alt-only reports',()=>{
  for(const data of [{title:'NA PvP Horde',body:'I created my first Horde on NA PvP.'},{body:'I created my first Horde on EU RP-PvP.'},{date:now-3600001},{body:"I could not create my first Horde character on EU PvP."},{body:'I just created another Horde alt on EU PvP.'},{body:'I created my first Horde yesterday on EU PvP.'}]) assert.equal(candidate(make(data),now),false);
});
test('requires two independent authors, deduplicates author and alerted evidence',()=>{
  assert.deepEqual(newEvidence([make(),make({id:'b'})],{},now),[]);
  const b=make({id:'b',author:'two'});
  assert.equal(newEvidence([make(),b],{},now).length,2);
  assert.deepEqual(newEvidence([make(),b],{alerted:{a:now,b:now}},now),[]);
});
test('parses RSS and Atom; quoted claims are not treated as the author report',()=>{
  const rss='<rss><channel><item><guid>a</guid><link>https://eu.forums.blizzard.com/en/wow/t/a/1</link><title>EU PvP Horde</title><dc:creator>one</dc:creator><pubDate>'+new Date(now).toUTCString()+'</pubDate><description><![CDATA[<blockquote>I created my first Horde on EU PvP.</blockquote>Still locked for me.]]></description></item></channel></rss>';
  assert.equal(candidate(parseFeed(rss,'test')[0],now),false);
  const atom='<feed><entry><id>a</id><title>EU PvP Horde</title><link href="https://www.reddit.com/r/wowforever/comments/a/"/><author><name>one</name></author><published>'+new Date(now).toISOString()+'</published><content>I created my first Horde on EU PvP.</content></entry></feed>';
  assert.equal(candidate(parseFeed(atom,'test')[0],now),true);
  assert.throws(()=>parseFeed('<html>blocked</html>','test'));
});

test('cloud state bootstraps a missing branch and updates using the returned blob SHA',async t=>{
  const savedEnv={...process.env};
  t.after(()=>{process.env=savedEnv;});
  process.env.GITHUB_ACTIONS='true';
  process.env.GITHUB_REPOSITORY='owner/repo';
  process.env.GH_TOKEN='fixture';
  const base='https://api.github.com/repos/owner/repo';
  const expected=[
    ['GET',`${base}/git/ref/heads/monitor-state`,404,{}],
    ['GET',base,200,{default_branch:'main'}],
    ['GET',`${base}/git/ref/heads/main`,200,{object:{sha:'head'}}],
    ['POST',`${base}/git/refs`,201,{}],
    ['GET',`${base}/contents/monitor-state.json?ref=monitor-state`,404,{}],
    ['PUT',`${base}/contents/monitor-state.json`,201,{content:{sha:'first'}}],
    ['PUT',`${base}/contents/monitor-state.json`,200,{content:{sha:'second'}}],
  ];
  const writes=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const [method,target,status,body]=expected.shift();
    assert.equal(url,target); assert.equal(options.method || 'GET',method);
    if(method==='PUT') writes.push(JSON.parse(options.body));
    return Response.json(body,{status});
  });
  const store=await stateStore();
  store.state.lastCheck=now;
  await store.save(); await store.save();
  assert.equal(expected.length,0);
  assert.equal(writes[0].sha,undefined);
  assert.equal(writes[1].sha,'first');
  assert.equal(JSON.parse(Buffer.from(writes[0].content,'base64')).lastCheck,now);
});

test('cloud state reports an unexpected GitHub failure clearly',async t=>{
  const savedEnv={...process.env}; t.after(()=>{process.env=savedEnv;});
  process.env.GITHUB_ACTIONS='true'; process.env.GITHUB_REPOSITORY='owner/repo';
  t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Forbidden'},{status:403}));
  await assert.rejects(stateStore(),/GitHub state HTTP 403/);
});

test('a recent cloud check skips all feed requests instead of catching up',async t=>{
  const savedEnv={...process.env}; t.after(()=>{process.env=savedEnv;});
  process.env.GITHUB_ACTIONS='true'; process.env.GITHUB_REPOSITORY='owner/repo';
  const requested=[];
  t.mock.method(globalThis,'fetch',async url=>{
    requested.push(url);
    if(url.endsWith('/git/ref/heads/monitor-state')) return Response.json({});
    if(url.endsWith('/contents/monitor-state.json?ref=monitor-state')) return Response.json({sha:'saved',content:Buffer.from(JSON.stringify({lastCheck:Date.now()-1000})).toString('base64')});
    throw Error('Unexpected source query or state write');
  });
  await main();
  assert.equal(requested.length,2);
});

test('a five-minute scheduled check tolerates a 30-second earlier runner start',async t=>{
  const savedEnv={...process.env}; t.after(()=>{process.env=savedEnv;});
  process.env.GITHUB_ACTIONS='true'; process.env.GITHUB_REPOSITORY='owner/repo';
  const feeds=[]; const writes=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    if(url.endsWith('/git/ref/heads/monitor-state')) return Response.json({});
    if(url.endsWith('/contents/monitor-state.json?ref=monitor-state')) return Response.json({sha:'saved',content:Buffer.from(JSON.stringify({lastCheck:Date.now()-270000})).toString('base64')});
    if(url.endsWith('/contents/monitor-state.json') && options.method==='PUT') {
      writes.push(JSON.parse(options.body));
      return Response.json({content:{sha:`save-${writes.length}`}});
    }
    if(FEEDS.includes(url)) {feeds.push(url); return new Response('<rss><channel></channel></rss>');}
    throw Error('Unexpected request');
  });
  await main();
  assert.deepEqual(feeds,FEEDS);
  assert.equal(writes.length,2);
  assert.equal(writes[1].sha,'save-1');
});

const STEP = 300000;
const SIX_HOURS = 6 * 3600000;
function healthFixture(state = {}) {
  const messages = [];
  const store = {state, save: async () => {}};
  const send = async (title, body) => messages.push({title, body});
  const check = async (failed, at, opening = false) => {
    const stats = recordHealth(state, failed, at);
    await notifyHealth(store, stats, failed, 'fixture failure', opening, send);
    return stats;
  };
  return {state, messages, check};
}

test('twelve consecutive failed runs alert once; changes and continued failures stay quiet', async () => {
  const {check, messages} = healthFixture();
  for (let i = 0; i < 11; i++) await check(true, now + i * STEP);
  assert.equal(messages.length, 0);
  await check(true, now + 11 * STEP);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /12 consecutive/);
  for (let i = 12; i < 36; i++) await check(true, now + i * STEP);
  assert.equal(messages.length, 1);
});

test('an unalerted transient failure recovers silently and resets the consecutive count', async () => {
  const {check, messages} = healthFixture();
  for (let i = 0; i < 11; i++) await check(true, now + i * STEP);
  await check(false, now + 11 * STEP);
  const stats = await check(true, now + 12 * STEP);
  assert.equal(stats.consecutive, 1);
  assert.equal(messages.length, 0);
});

test('a resolved consecutive-failure incident permits a later failure alert', async () => {
  const {check, messages} = healthFixture();
  for (let i = 0; i < 12; i++) await check(true, now + i * STEP);
  await check(false, now + 12 * STEP);
  await check(false, now + 13 * STEP);
  for (let i = 14; i < 26; i++) await check(true, now + i * STEP);
  assert.deepEqual(messages.map(m => m.title), [
    'MONITOR CHECK FAILED - WoW', 'WoW monitor back to normal', 'MONITOR CHECK FAILED - WoW',
  ]);
});

test('ratio needs a full six-hour observation period and strictly more than 50%', async () => {
  const {check, messages} = healthFixture();
  // Alternation prevents the consecutive threshold from masking the ratio test.
  for (let i = 0; i <= 72; i++) await check(i % 2 === 0, now + i * STEP);
  assert.equal(messages.length, 0); // Exactly 36/72 failures at six hours.
  const stats = await check(true, now + 73 * STEP);
  assert.equal(stats.total, 72);
  assert.equal(stats.failures, 37);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body, /37\/72.*six hours/);
});

test('ratio alert stays active through isolated successes and recovers at 50%', async () => {
  const {check, messages} = healthFixture();
  for (let i = 0; i <= 72; i++) await check(i % 3 !== 2, now + i * STEP);
  assert.equal(messages.length, 1);
  await check(false, now + 73 * STEP);
  assert.equal(messages.length, 1);
  for (let i = 74; i <= 100; i++) await check(false, now + i * STEP);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].title, 'WoW monitor back to normal');
});

test('expired outcomes leave the six-hour window; run IDs prevent double counting', () => {
  const state = {};
  recordHealth(state, true, now, 'same-run');
  recordHealth(state, true, now + 1000, 'same-run');
  assert.equal(state.health.history.length, 1);
  recordHealth(state, false, now + 2000, 'same-run');
  assert.equal(state.health.history[0].failed, false);
  const stats = recordHealth(state, false, now + SIX_HOURS, 'later-run');
  assert.equal(stats.total, 1);
  assert.equal(stats.failures, 0);
});

test('opening supersedes a failure or recovery message and ends the incident silently', async () => {
  const {check, messages, state} = healthFixture();
  for (let i = 0; i < 11; i++) await check(true, now + i * STEP);
  await check(true, now + 11 * STEP, true);
  assert.equal(messages.length, 0);
  await check(true, now + 12 * STEP);
  assert.equal(messages.length, 1);
  await check(true, now + 13 * STEP, true);
  await check(false, now + 14 * STEP);
  assert.equal(messages.length, 1);
  assert.equal(state.health.alertActive, false);
});

test('legacy state preserves evidence, interval guard, and an already alerted incident', async () => {
  const state = {lastCheck: now, alerted: {a: now}, failure: 'old source error', failureAt: now};
  const {check, messages} = healthFixture(state);
  await check(true, now + STEP);
  assert.equal(messages.length, 0);
  await check(false, now + 2 * STEP);
  assert.equal(messages.length, 1);
  assert.equal(state.lastCheck, now);
  assert.deepEqual(state.alerted, {a: now});
  assert.equal(state.failure, undefined);
});

test('notification failure cannot cause repeated failure attempts or a false recovery', async () => {
  const state = {};
  let stats;
  for (let i = 0; i < 12; i++) stats = recordHealth(state, true, now + i * STEP);
  let attempts = 0;
  const store = {state, save: async () => {}};
  const brokenSend = async () => {attempts++; throw Error('fixture ntfy timeout');};
  await assert.rejects(notifyHealth(store, stats, true, 'fixture', false, brokenSend), /timeout/);
  await notifyHealth(store, stats, true, 'changed error', false, brokenSend);
  const recovered = recordHealth(state, false, now + 12 * STEP);
  await notifyHealth(store, recovered, false, '', false, brokenSend);
  assert.equal(attempts, 1);
  assert.equal(state.health.alertActive, false);
});

test('state must be saved before any health notification is attempted', async () => {
  const state = {};
  let stats;
  for (let i = 0; i < 12; i++) stats = recordHealth(state, true, now + i * STEP);
  let attempts = 0;
  await assert.rejects(notifyHealth({state, save: async () => {throw Error('fixture storage unavailable');}},
    stats, true, 'fixture', false, async () => {attempts++;}), /storage unavailable/);
  assert.equal(attempts, 0);
});

test('failed recovery delivery keeps repeat failure alerts suppressed', async () => {
  const {state, check, messages} = healthFixture();
  for (let i = 0; i < 12; i++) await check(true, now + i * STEP);
  const stats = recordHealth(state, false, now + 12 * STEP);
  await assert.rejects(notifyHealth({state, save: async () => {}}, stats, false, '', false,
    async () => {throw Error('fixture recovery timeout');}), /recovery timeout/);
  assert.equal(state.health.alertActive, true);
  for (let i = 13; i < 26; i++) await check(true, now + i * STEP);
  assert.equal(messages.length, 1);
});

test('opening evidence alerts before health warnings even with failing feeds', async t => {
  const savedEnv = {...process.env};
  const savedExitCode = process.exitCode;
  const savedArgv = [...process.argv];
  t.after(() => {process.env = savedEnv; process.exitCode = savedExitCode; process.argv = savedArgv;});
  process.env.GITHUB_ACTIONS = 'true'; process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_RUN_ID = 'opening-run'; process.env.NTFY_TOPIC = 'fixture-only';
  const state = {};
  for (let i = 0; i < 11; i++) recordHealth(state, true, now - (11 - i) * STEP);
  const pushes = [];
  let persisted = state;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url.endsWith('/git/ref/heads/monitor-state')) return Response.json({});
    if (url.endsWith('/contents/monitor-state.json?ref=monitor-state'))
      return Response.json({sha: 'fixture', content: Buffer.from(JSON.stringify(persisted)).toString('base64')});
    if (url.endsWith('/contents/monitor-state.json') && options.method === 'PUT') {
      persisted = JSON.parse(Buffer.from(JSON.parse(options.body).content, 'base64').toString());
      return Response.json({content: {sha: 'updated'}});
    }
    if (url === FEEDS[0]) return new Response(`<rss><channel><item><guid>staff</guid><link>https://eu.forums.blizzard.com/en/wow/t/a/1</link><title>EU PvP Horde</title><dc:creator>Kaivax</dc:creator><pubDate>${new Date(now).toUTCString()}</pubDate><description>Horde character creation is now enabled on EU PvP.</description></item></channel></rss>`);
    if (FEEDS.includes(url)) throw Error('Fixture feed unavailable');
    if (url === 'https://ntfy.sh/fixture-only') {pushes.push(options.headers.Title); return new Response('ok');}
    throw Error('Unexpected request');
  });
  await main();
  // The workflow fallback sees the same failed run, with its opening already sent.
  process.argv.push('--record-failure');
  await main();
  assert.deepEqual(pushes, ['EU PvP Horde - Blizzard post']);
  assert.equal(persisted.health.history.length, 12);
});
