import test from 'node:test';
import assert from 'node:assert/strict';
import {candidate,newEvidence,parseFeed,staffStatement,stateStore,main} from './monitor.mjs';
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