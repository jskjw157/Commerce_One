import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { State } from './types.js';

function unique(keys: string[], message: string) { if(new Set(keys).size!==keys.length) throw new Error(message); }
function validate(s: State) {
  if(s.version!==1 || s.synthetic!==true || typeof s.secret!=='string' || s.secret.length!==64 || !Array.isArray(s.requests) || !Array.isArray(s.reviews) || !Array.isArray(s.quarantine)) throw new Error('STORE_INVALID');
  unique(s.requests.map(r=>r.orderId),'UNIQUE_REQUEST_ORDER'); unique(s.requests.map(r=>r.id),'UNIQUE_REQUEST_ID');
  unique(s.reviews.map(r=>r.id),'UNIQUE_REVIEW_ID');
  unique(s.reviews.filter(r=>r.source.kind==='order').map(r=>JSON.stringify([r.orderId,r.productId])),'UNIQUE_ORDER_PRODUCT');
  unique(s.reviews.filter(r=>r.source.kind==='import').map(r=>JSON.stringify([r.source.name,r.source.sourceId])),'UNIQUE_IMPORT_SOURCE');
  unique(s.quarantine.map(q=>q.key),'UNIQUE_QUARANTINE');
  if(s.reviews.some(r=>!r.synthetic || (r.source.kind==='import' && r.mockVerified))) throw new Error('STORE_SYNTHETIC_ONLY');
}
/** Single process, synchronous copy-on-write transactions. Never share a data directory. */
export class FileStore {
  private state: State;
  private lockFd: number | undefined;
  private readonly file: string;
  private readonly lock: string;
  constructor(private dir: string) {
    mkdirSync(dir,{recursive:true,mode:0o700}); this.file=join(dir,'state.json'); this.lock=join(dir,'store.lock');
    try { this.lockFd=openSync(this.lock,'wx',0o600); writeFileSync(this.lockFd,String(process.pid)); }
    catch { throw new Error('STORE_LOCKED: another process or stale lock; verify process before removing lock'); }
    try {
      if(existsSync(this.file)) { this.state=JSON.parse(readFileSync(this.file,'utf8')) as State; validate(this.state); }
      else { this.state={version:1,synthetic:true,secret:randomBytes(32).toString('hex'),requests:[],reviews:[],quarantine:[]}; this.persist(this.state); }
    } catch(error) { this.close(); throw error; }
  }
  read(): State { return structuredClone(this.state); }
  transaction<T>(fn: (draft: State) => T): T {
    if(this.lockFd===undefined) throw new Error('STORE_CLOSED');
    const draft=this.read(); const result=fn(draft); validate(draft); this.persist(draft); this.state=draft; return structuredClone(result);
  }
  private persist(s: State) {
    const temp=`${this.file}.tmp`;
    let fd: number | undefined;
    try { fd=openSync(temp,'w',0o600); writeFileSync(fd,JSON.stringify(s,null,2)); fsyncSync(fd); closeSync(fd); fd=undefined; renameSync(temp,this.file); }
    finally { if(fd!==undefined) closeSync(fd); rmSync(temp,{force:true}); }
  }
  close() { if(this.lockFd!==undefined) {closeSync(this.lockFd); this.lockFd=undefined; rmSync(this.lock,{force:true});} }
}
