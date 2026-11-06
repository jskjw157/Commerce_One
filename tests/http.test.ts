import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createPilotServer } from '../src/server.js';
import { FileStore } from '../src/store.js';
import { Pilot } from '../src/domain.js';
import { MockPlatform } from '../src/mock.js';

async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'commerce-http-')); const store=new FileStore(dir);
  const pilot=new Pilot(store,new MockPlatform()); const server=createPilotServer(pilot);
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const address=server.address();
  if(!address || typeof address==='string') throw new Error('address'); const origin=`http://127.0.0.1:${address.port}`;
  const call=async (path:string,body?:unknown,cookie='',headers:Record<string,string>={})=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const login=async (role:string,buyerId='SYN-BUYER-A')=>{ const r=await call('/api/demo/login',{role,buyerId}); assert.equal(r.status,200); return r.headers.get('set-cookie')!.split(';')[0]!; };
  return {store,pilot,server,origin,call,login,close:async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('HTTP: auth boundaries, concurrent requests and product writes, projection and import rerun',async()=>{
  const f=await fixture(); try {
    assert.equal((await f.call('/api/admin')).status,401);
    const admin=await f.login('admin'); const buyer=await f.login('buyer'); const other=await f.login('buyer','SYN-BUYER-B');
    assert.equal((await f.call('/api/admin',undefined,buyer)).status,401);
    const requests=await Promise.all(Array.from({length:12},()=>f.call('/api/admin/requests',{orderId:'SYN-O-100'},admin)));
    const data=await Promise.all(requests.map(r=>r.json()));
    assert.equal(new Set(data.map(d=>d.request.id)).size,1); assert.equal(f.pilot.admin().requests.length,1);
    const token=data[0].token as string;
    assert.equal((await f.call('/api/review-link',{token},other)).status,403);
    assert.equal((await f.call('/api/review-link',{token})).status,401);
    const payload={token,review:{productId:'SYN-P-100',rating:5,text:'[합성] 동시 제출 확인 후기'}};
    assert.equal((await f.call('/api/orders/SYN-O-200/reviews',payload,buyer)).status,403);
    assert.equal((await f.call('/api/orders/SYN-O-100/reviews',{...payload,review:{...payload.review,productId:'SYN-P-300'}},buyer)).status,403);
    const saves=await Promise.all(Array.from({length:12},()=>f.call('/api/orders/SYN-O-100/reviews',payload,buyer)));
    assert.ok(saves.every(r=>r.status===200)); assert.equal(f.pilot.admin().reviews.length,1);
    assert.equal((await f.call('/api/orders/SYN-O-100/reviews',{...payload,review:{...payload.review,text:'다른 합성 리뷰'}},buyer)).status,409);
    const widget=await (await f.call('/api/public/products/SYN-P-100/reviews')).json();
    assert.equal(widget.length,1); assert.doesNotMatch(JSON.stringify(widget),/SYN-O-|SYN-BUYER-|secret|token|expiresAt/);
    assert.equal((await f.call('/api/public/products/SYN-P-300/reviews')).status,200);
    assert.equal((await f.call('/api/public/products/unknown/reviews')).status,404);
    const first=await (await f.call('/api/admin/import',{},admin)).json(); assert.equal(first.imported,2);
    assert.equal((await (await f.call('/api/admin/import',{},admin)).json()).imported,0);
    assert.equal((await f.call('/api/admin/import',{rows:[{text:'unapproved'}]},admin)).status,400);
    assert.equal((await f.call('/api/admin/requests',{orderId:'SYN-O-PARTIAL'},admin)).status,409);
  } finally {await f.close();}
});
test('HTTP security headers and malformed requests',async()=>{
  const f=await fixture();try {
    const page=await f.call('/'); assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy')!,/connect-src 'self'/);
    assert.equal(page.headers.get('referrer-policy'),'no-referrer'); assert.match(page.headers.get('cache-control')!,/no-store/);
    assert.equal((await f.call('/api/demo/login',{role:'admin'},'',{origin:'https://example.invalid'})).status,403);
    const spoofed=await new Promise<number>(resolve=>{
      const req=request(f.origin+'/api/demo/login',{method:'POST',headers:{host:'attacker.invalid',origin:f.origin,'content-type':'application/json'}},res=>{res.resume();resolve(res.statusCode!);});
      req.end(JSON.stringify({role:'admin',buyerId:'SYN-BUYER-A'}));
    });
    assert.equal(spoofed,403);
    assert.equal((await fetch(f.origin+'/api/demo/login',{method:'POST',headers:{origin:f.origin,'content-type':'application/json'},body:'{bad'})).status,400);
    assert.equal((await f.call('/api/demo/login',{role:'admin',buyerId:'x'.repeat(20000)})).status,413);
    assert.equal((await f.call('/api/demo/login',{role:'admin'},'',{'content-type':'text/plain'})).status,415);
    assert.equal((await f.call('/api/demo/login',{role:'buyer',buyerId:'REAL-CUSTOMER'})).status,400);
    assert.equal((await f.call('/state.json')).status,404); assert.equal((await f.call('/api/nope')).status,404);
  } finally {await f.close();}
});

test('HTTP: split UTF-8 request preserves Korean text and exact replay semantics',async()=>{
  const f=await fixture();try {
    const admin=await f.login('admin');const buyer=await f.login('buyer');
    const {token}=await (await f.call('/api/admin/requests',{orderId:'SYN-O-100'},admin)).json();
    const review={productId:'SYN-P-100',rating:5,text:'합성 테스트 후기'};
    const bytes=Buffer.from(JSON.stringify({token,review}));
    const split=bytes.indexOf(Buffer.from('합'))+1;
    const status=await new Promise<number>((resolve,reject)=>{
      const req=request(f.origin+'/api/orders/SYN-O-100/reviews',{method:'POST',headers:{origin:f.origin,'content-type':'application/json',cookie:buyer,'transfer-encoding':'chunked'}},res=>{res.resume();resolve(res.statusCode!);});
      req.on('error',reject);
      req.write(bytes.subarray(0,split),()=>{setImmediate(()=>req.end(bytes.subarray(split)));});
    });
    assert.equal(status,200);
    assert.equal(f.pilot.admin().reviews[0]?.text,review.text);
    assert.equal((await f.call('/api/orders/SYN-O-100/reviews',{token,review},buyer)).status,200);
    assert.equal(f.pilot.admin().reviews.length,1);
  }finally{await f.close();}
});
