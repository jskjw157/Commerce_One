import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {FileStore} from '../src/store.js';

test('killed process recovers acknowledged records after explicit stale-lock recovery; duplicate retry stays unique',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'commerce-restart-'));
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const address=probe.address();if(!address || typeof address==='string') throw new Error('address');
  const port=address.port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const origin=`http://127.0.0.1:${port}`;
  async function start() {
    const child=spawn(process.execPath,['dist/src/main.js'],{env:{PATH:process.env.PATH,PORT:String(port),PILOT_DATA_DIR:dir,PILOT_MODE:'mock'},stdio:['ignore','pipe','pipe']});
    let error='';child.stderr.on('data',c=>{error+=c.toString();});
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('startup timeout '+error));},5000);
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('startup failed '+error));});
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
    });return child;
  }
  const call=async(path:string,body:unknown,cookie='')=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify(body)});
  const login=async(role:string)=>{const res=await call('/api/demo/login',{role,buyerId:'SYN-BUYER-A'});assert.equal(res.status,200);return res.headers.get('set-cookie')!.split(';')[0]!;};
  let child=await start();
  try {
    let admin=await login('admin');let buyer=await login('buyer');
    const first=await (await call('/api/admin/requests',{orderId:'SYN-O-100'},admin)).json();
    const payload={token:first.token,review:{productId:'SYN-P-100',rating:5,text:'[합성] 프로세스 중단 복구'}};
    const saved=await (await call('/api/orders/SYN-O-100/reviews',payload,buyer)).json();
    assert.equal(typeof saved.id,'string');
    child.kill('SIGKILL');await once(child,'exit');
    assert.throws(()=>new FileStore(dir),/STORE_LOCKED/);
    // Only after the owning child has exited: recover the stale lock, never auto-steal a live lock.
    rmSync(join(dir,'store.lock'));
    writeFileSync(join(dir,'state.json.tmp'),'incomplete synthetic write');
    child=await start();admin=await login('admin');buyer=await login('buyer');
    const second=await (await call('/api/admin/requests',{orderId:'SYN-O-100'},admin)).json();
    assert.equal(second.request.id,first.request.id);assert.equal(second.token,first.token);
    const replay=await (await call('/api/orders/SYN-O-100/reviews',payload,buyer)).json();
    assert.equal(replay.id,saved.id);assert.equal(replay.replayed,true);
    const data=await (await fetch(origin+'/api/admin',{headers:{cookie:admin}})).json();
    assert.equal(data.requests.length,1);assert.equal(data.reviews.length,1);
  } finally {
    if(child.exitCode===null && child.signalCode===null) {child.kill('SIGTERM');await once(child,'exit');}
    rmSync(dir,{recursive:true,force:true});
  }
});
