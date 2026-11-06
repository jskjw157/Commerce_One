import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pilot, PilotError } from '../src/domain.js';
import { FileStore } from '../src/store.js';
import { MockPlatform, importFixture } from '../src/mock.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'commerce-pilot-'));
  const store = new FileStore(dir);
  const platform = new MockPlatform();
  let now = Date.parse('2026-11-06T12:00:00Z');
  const pilot = new Pilot(store, platform, () => now);
  return { dir, store, platform, pilot, advance: (ms: number) => { now += ms; }, close: () => { store.close(); rmSync(dir, {recursive: true, force: true}); } };
}
function rejects(fn: () => unknown, code: string) {
  assert.throws(fn, (e: unknown) => e instanceof PilotError && e.code === code);
}

test('request is unique per order, with two distinct product review slots', () => {
  const f = setup(); try {
    const a = f.pilot.request('SYN-O-100');
    const b = f.pilot.request('SYN-O-100');
    assert.equal(a.request.id, b.request.id); assert.equal(a.token, b.token);
    assert.equal(f.pilot.admin().requests.length, 1);
    assert.deepEqual(f.pilot.open(a.token, 'SYN-BUYER-A').products.map(p => p.id), ['SYN-P-100','SYN-P-200']);
  } finally { f.close(); }
});
for (const order of ['SYN-O-PARTIAL','SYN-O-CANCELLED','SYN-O-RETURNED','SYN-O-UNPAID']) {
  test(`holds ineligible order ${order}`, () => { const f=setup(); try { rejects(()=>f.pilot.request(order),'ORDER_HELD'); assert.equal(f.pilot.admin().requests.length,0); } finally {f.close();} });
}
test('tampering, wrong buyer, other order and unrelated product never create reviews', () => {
  const f=setup(); try {
    const {token}=f.pilot.request('SYN-O-100');
    rejects(()=>f.pilot.open(token+'x','SYN-BUYER-A'),'LINK_INVALID');
    rejects(()=>f.pilot.open(token,'SYN-BUYER-B'),'ACCESS_DENIED');
    rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-200',{productId:'SYN-P-100',rating:5,text:'합성 테스트 후기'}),'ACCESS_DENIED');
    rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',{productId:'SYN-P-300',rating:5,text:'합성 테스트 후기'}),'PRODUCT_NOT_IN_ORDER');
    assert.equal(f.pilot.admin().reviews.length,0);
  } finally {f.close();}
});
test('exact replay is idempotent per order/product; changed content conflicts; consumption allows only exact retry', () => {
  const f=setup(); try {
    const {token}=f.pilot.request('SYN-O-100');
    const body={productId:'SYN-P-100',rating:4,text:'합성 테스트 텍스트'};
    const first=f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body);
    assert.equal(f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body).review.id,first.review.id);
    rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',{...body,rating:3}),'REVIEW_CONFLICT');
    f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',{...body,productId:'SYN-P-200'});
    assert.equal(f.pilot.open(token,'SYN-BUYER-A').status,'consumed');
    assert.equal(f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body).replayed,true);
    assert.equal(f.pilot.admin().reviews.length,2);
  } finally {f.close();}
});
test('expiry is enforced at exact deadline even for replays; changed order state blocks saved links', () => {
  const f=setup(); try {
    const {token}=f.pilot.request('SYN-O-100');
    const body={productId:'SYN-P-100',rating:5,text:'합성 검증 텍스트'};
    f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body);
    f.platform.holdOrder('SYN-O-100','returned');
    rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body),'ORDER_HELD');
    f.advance(7*24*60*60*1000);
    rejects(()=>f.pilot.open(token,'SYN-BUYER-A'),'LINK_EXPIRED');
    rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body),'LINK_EXPIRED');
    assert.equal(f.pilot.admin().requests.length,1);
  } finally {f.close();}
});
test('input validation rejects malformed ratings, text, huge/empty text and extra fields', () => {
  const f=setup(); try { const {token}=f.pilot.request('SYN-O-100');
    for(const body of [null,[],{}, {productId:'SYN-P-100',rating:6,text:'abc'}, {productId:'SYN-P-100',rating:3.5,text:'abc'}, {productId:'SYN-P-100',rating:5,text:''}, {productId:'SYN-P-100',rating:5,text:'x'.repeat(1001)}, {productId:'SYN-P-100',rating:5,text:'abc',verified:true}]) {
      rejects(()=>f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body),'INPUT_INVALID');
    }
  } finally {f.close();}
});
test('public widget exposes only its product and safe fields, and labels mock purchase confirmation', () => {
  const f=setup(); try { const {token}=f.pilot.request('SYN-O-100');
    f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',{productId:'SYN-P-100',rating:5,text:'<img src=x onerror="window.pwned=1"> 합성'});
    const rows=f.pilot.widget('SYN-P-100'); assert.equal(rows.length,1);
    assert.equal(rows[0]?.badge,'테스트 주문 확인 · 합성 데이터');
    assert.deepEqual(Object.keys(rows[0]!).sort(),['badge','id','rating','source','synthetic','text'].sort());
    assert.equal(f.pilot.widget('SYN-P-200').length,0);
    assert.doesNotMatch(JSON.stringify(rows),/SYN-O-|SYN-BUYER-|token|secret/);
  } finally {f.close();}
});
test('import preserves provenance, isolates mapping/ambiguity, never verifies purchase and is repeatable', () => {
  const f=setup(); try {
    const first=f.pilot.importRows(importFixture);
    assert.deepEqual(first,{imported:2,skipped:0,quarantined:2});
    const after=f.pilot.admin(); assert.equal(after.reviews.length,2); assert.equal(after.quarantine.length,2);
    assert.ok(after.reviews.every(r=>r.synthetic && !r.mockVerified && r.source.kind==='import' && r.source.rightsConfirmed));
    assert.equal(f.pilot.importRows(importFixture).imported,0);
    assert.equal(f.pilot.admin().reviews.length,2); assert.equal(f.pilot.admin().quarantine.length,2);
    assert.ok(f.pilot.widget('SYN-P-100').every(r=>r.badge==='가져온 합성 리뷰 · 구매 미검증'));
    assert.ok(f.pilot.widget('SYN-P-100')[0]?.source.includes('합성 원본'));
  } finally {f.close();}
});
test('same source/id with changed content or product is quarantined without overwrite; rejected rights are isolated', () => {
  const f=setup(); try {
    f.pilot.importRows([importFixture[0]!]);
    const original=f.pilot.admin().reviews[0];
    for (const row of [{...importFixture[0]!,text:'변경된 합성 내용'},{...importFixture[0]!,sourceProductId:'SKU-SYN-200'},{...importFixture[0]!,sourceId:'rights-missing',rightsConfirmed:false}]) {
      assert.equal(f.pilot.importRows([row]).quarantined,1);
      assert.equal(f.pilot.importRows([row]).quarantined,0);
    }
    assert.deepEqual(f.pilot.admin().reviews[0],original); assert.equal(f.pilot.admin().quarantine.length,3);
  } finally {f.close();}
});
test('restart retains uniqueness, token verification and import quarantine; second process cannot open store', () => {
  const f=setup(); try {
    const {token}=f.pilot.request('SYN-O-100');
    const body={productId:'SYN-P-100',rating:5,text:'재시작 합성 확인'};
    const first=f.pilot.submit(token,'SYN-BUYER-A','SYN-O-100',body);
    f.pilot.importRows(importFixture);
    assert.throws(()=>new FileStore(f.dir),/STORE_LOCKED/);
    f.store.close(); const reopened=new FileStore(f.dir);
    try { const p=new Pilot(reopened,f.platform,()=>Date.parse('2026-11-06T12:00:00Z'));
      assert.equal(p.request('SYN-O-100').token,token);
      assert.equal(p.submit(token,'SYN-BUYER-A','SYN-O-100',body).review.id,first.review.id);
      assert.equal(p.importRows(importFixture).imported,0); assert.equal(p.admin().quarantine.length,2);
    } finally {reopened.close();}
  } finally {f.close();}
});
test('transaction failure rolls back memory and disk; unique-key invariant rejects duplicate inserts', () => {
  const f=setup(); try {
    f.pilot.request('SYN-O-100'); const before=readFileSync(join(f.dir,'state.json'),'utf8');
    assert.throws(()=>f.store.transaction(s=>{s.requests.push({...s.requests[0]!});}),/UNIQUE_REQUEST_ORDER/);
    assert.equal(readFileSync(join(f.dir,'state.json'),'utf8'),before); assert.equal(f.pilot.admin().requests.length,1);
    assert.throws(()=>f.store.transaction(s=>{s.reviews=[]; throw new Error('abort');}),/abort/);
    assert.equal(readFileSync(join(f.dir,'state.json'),'utf8'),before);
  } finally {f.close();}
});

test('failed disk write leaves request state untouched and a retry succeeds', () => {
  const f=setup(); try {
    f.pilot.request('SYN-O-100');
    const before=readFileSync(join(f.dir,'state.json'),'utf8');
    mkdirSync(join(f.dir,'state.json.tmp'));
    assert.throws(()=>f.pilot.request('SYN-O-200'));
    assert.equal(f.pilot.admin().requests.length,1);
    assert.equal(readFileSync(join(f.dir,'state.json'),'utf8'),before);
    rmSync(join(f.dir,'state.json.tmp'),{recursive:true});
    f.pilot.request('SYN-O-200');
    assert.equal(f.pilot.admin().requests.length,2);
  } finally {f.close();}
});
