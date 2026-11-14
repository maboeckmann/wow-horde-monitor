import test from 'node:test';
import assert from 'node:assert/strict';
import {candidate,newEvidence,parseFeed,staffStatement} from './monitor.mjs';
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
