import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pilot, PilotError } from './domain.js';
import { importFixture } from './mock.js';

type Session = { role: 'admin'|'buyer'; buyerId: string; expiresAt: number };
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
function json(res: ServerResponse,status: number,value: unknown) { res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<Record<string,unknown>> {
  if(req.headers['content-type']?.split(';')[0]!=='application/json') throw new PilotError('JSON_REQUIRED',415);
  const chunks: Buffer[]=[]; let length=0;
  for await (const chunk of req) {
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk); length+=bytes.length;
    if(length>16384) throw new PilotError('BODY_TOO_LARGE',413);
    chunks.push(bytes);
  }
  const data=Buffer.concat(chunks).toString('utf8');
  try { const parsed: unknown=JSON.parse(data); if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error(); return parsed as Record<string,unknown>; }
  catch { throw new PilotError('INPUT_INVALID'); }
}
function exactKeys(b: Record<string,unknown>,keys: string[]) { if(Object.keys(b).sort().join(',')!==keys.sort().join(',')) throw new PilotError('INPUT_INVALID'); }
export function createPilotServer(pilot: Pilot) {
  const sessions=new Map<string,Session>();
  function auth(req: IncomingMessage,role: Session['role']) {
    const token=(req.headers.cookie??'').split(';').map(c=>c.trim()).find(c=>c.startsWith(`pilot_${role}=`))?.split('=')[1];
    const s=token?sessions.get(token):undefined;
    if(!s || s.role!==role || s.expiresAt<=Date.now()) throw new PilotError('SESSION_REQUIRED',401);
    return s;
  }
  const server=createServer((req,res)=>{void handle(req,res);});
  server.requestTimeout=10000; server.headersTimeout=10000; server.maxHeadersCount=40;
  async function handle(req: IncomingMessage,res: ServerResponse) {
    res.setHeader('content-security-policy',csp); res.setHeader('x-content-type-options','nosniff');
    res.setHeader('referrer-policy','no-referrer');res.setHeader('cache-control','no-store');res.setHeader('x-frame-options','DENY');
    try {
      const origin=`http://127.0.0.1:${req.socket.localPort}`;
      if(req.headers.host!==`127.0.0.1:${req.socket.localPort}`) throw new PilotError('HOST_DENIED',403);
      if(req.method!=='GET' && req.method!=='POST') throw new PilotError('METHOD_NOT_ALLOWED',405);
      if(req.method==='POST' && req.headers.origin!==origin) throw new PilotError('ORIGIN_DENIED',403);
      const url=new URL(req.url??'/',origin); const path=url.pathname;
      if(url.search) throw new PilotError('QUERY_NOT_ALLOWED');
      if(req.method==='POST' && path==='/api/demo/login') {
        const b=await body(req);exactKeys(b,['role','buyerId']);
        if((b.role!=='admin' && b.role!=='buyer') || (b.buyerId!=='SYN-BUYER-A' && b.buyerId!=='SYN-BUYER-B')) throw new PilotError('INPUT_INVALID');
        for(const [key,s] of sessions) if(s.expiresAt<=Date.now()) sessions.delete(key);
        if(sessions.size>=100) throw new PilotError('SESSION_LIMIT',429);
        const token=randomBytes(32).toString('hex');
        sessions.set(token,{role:b.role,buyerId:b.buyerId,expiresAt:Date.now()+3600000});
        res.setHeader('set-cookie',`pilot_${b.role}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
        return json(res,200,{synthetic:true,role:b.role});
      }
      if(path.startsWith('/api/admin')) {
        auth(req,'admin');
        if(req.method==='GET' && path==='/api/admin') return json(res,200,pilot.admin());
        if(req.method==='POST' && path==='/api/admin/requests') {
          const b=await body(req);exactKeys(b,['orderId']); if(typeof b.orderId!=='string') throw new PilotError('INPUT_INVALID');
          return json(res,200,pilot.request(b.orderId));
        }
        if(req.method==='POST' && path==='/api/admin/import') {const b=await body(req);exactKeys(b,[]);return json(res,200,pilot.importRows(importFixture));}
      }
      if(req.method==='POST' && path==='/api/review-link') {
        const s=auth(req,'buyer');const b=await body(req);exactKeys(b,['token']);if(typeof b.token!=='string') throw new PilotError('INPUT_INVALID');
        return json(res,200,pilot.open(b.token,s.buyerId));
      }
      const write=/^\/api\/orders\/(SYN-[A-Z0-9-]+)\/reviews$/.exec(path);
      if(req.method==='POST' && write) {
        const s=auth(req,'buyer'); const b=await body(req);exactKeys(b,['token','review']);if(typeof b.token!=='string') throw new PilotError('INPUT_INVALID');
        const result=pilot.submit(b.token,s.buyerId,write[1]!,b.review);
        // The buyer needs no internal order/provenance record after saving.
        return json(res,200,{id:result.review.id,productId:result.review.productId,replayed:result.replayed,synthetic:true});
      }
      const widget=/^\/api\/public\/products\/([^/]+)\/reviews$/.exec(path);
      if(req.method==='GET' && widget) return json(res,200,pilot.widget(widget[1]!));
      if(req.method==='GET' && path==='/api/public/products') return json(res,200,pilot.products());
      if(req.method==='GET') {
        const staticFiles: Record<string,[string,string]>={'/app.js':['app.js','text/javascript'],'/widget.js':['widget.js','text/javascript'],'/styles.css':['styles.css','text/css']};
        let asset=staticFiles[path];
        if(path==='/' || path==='/admin' || path==='/write' || /^\/products\/SYN-P-(100|200|300)$/.test(path)) asset=['index.html','text/html'];
        if(asset) {const file=readFileSync(fileURLToPath(new URL(`../public/${asset[0]}`,import.meta.url)));res.writeHead(200,{'content-type':`${asset[1]}; charset=utf-8`});res.end(file);return;}
      }
      json(res,404,{error:'NOT_FOUND'});
    } catch(error) {
      if(res.headersSent) {res.end();return;}
      if(error instanceof PilotError) json(res,error.status,{error:error.code});
      else json(res,500,{error:'INTERNAL_ERROR'});
    }
  }
  return server;
}
