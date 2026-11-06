import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ImportRow, Platform, RequestRecord, Review, State } from './types.js';
import { FileStore } from './store.js';
export class PilotError extends Error { constructor(public code: string, public status=400) {super(code);} }
const fail=(code: string,status=400): never=>{throw new PilotError(code,status);};
const digest=(s: string)=>createHash('sha256').update(s).digest('hex');
function input(value: unknown): {productId:string;rating:number;text:string} {
  if(!value || typeof value!=='object' || Array.isArray(value)) return fail('INPUT_INVALID');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='productId,rating,text' || typeof v.productId!=='string' || !Number.isInteger(v.rating) || Number(v.rating)<1 || Number(v.rating)>5 || typeof v.text!=='string' || v.text.trim().length<3 || v.text.trim().length>1000) return fail('INPUT_INVALID');
  return {productId:v.productId,rating:Number(v.rating),text:v.text.trim()};
}
const canonical=(row: ImportRow)=>JSON.stringify([row.synthetic,row.sourceName,row.sourceId,row.sourceProductId,row.rightsConfirmed,row.rating,row.text]);
const content=(text: string)=>text.trim().normalize('NFKC').replace(/\s+/g,' ');
export class Pilot {
  constructor(private store: FileStore, private platform: Platform, private now=()=>Date.now()) {}
  private eligible(orderId: string) {
    const order=this.platform.getOrder(orderId);
    if(!order) return fail('ORDER_NOT_FOUND',404);
    if(!order.synthetic || !order.paid || order.status!=='delivered' || order.productIds.length===0 || order.productIds.some(id=>!this.platform.products().some(p=>p.id===id))) return fail('ORDER_HELD',409);
    return order;
  }
  private token(s: State, r: RequestRecord) { return `${r.id}.${createHmac('sha256',s.secret).update(JSON.stringify([r.id,r.orderId,r.expiresAt])).digest('hex')}`; }
  request(orderId: string) {
    this.eligible(orderId);
    return this.store.transaction(s=>{
      let r=s.requests.find(r=>r.orderId===orderId); const replayed=Boolean(r);
      if(!r) {r={id:randomUUID(),orderId,createdAt:this.now(),expiresAt:this.now()+7*86400000,synthetic:true}; s.requests.push(r);}
      return {request:r,token:this.token(s,r),replayed};
    });
  }
  private authorize(s: State, token: string, buyerId: string) {
    if(typeof token!=='string' || token.length>200) return fail('LINK_INVALID',403);
    const r=s.requests.find(r=>r.id===token.split('.')[0]);
    if(!r) return fail('LINK_INVALID',403);
    const expected=Buffer.from(this.token(s,r)); const actual=Buffer.from(token);
    if(expected.length!==actual.length || !timingSafeEqual(expected,actual)) return fail('LINK_INVALID',403);
    if(this.now()>=r.expiresAt) return fail('LINK_EXPIRED',410);
    const order=this.platform.getOrder(r.orderId);
    if(!order || order.buyerId!==buyerId) return fail('ACCESS_DENIED',403);
    this.eligible(order.id); return {request:r,order};
  }
  open(token: string, buyerId: string) {
    const s=this.store.read(); const {request,order}=this.authorize(s,token,buyerId);
    const products=this.platform.products().filter(p=>order.productIds.includes(p.id)).map(p=>({...p,submitted:s.reviews.some(r=>r.orderId===order.id && r.productId===p.id)}));
    return {orderId:order.id,expiresAt:request.expiresAt,products,status:products.every(p=>p.submitted)?'consumed':'active',synthetic:true};
  }
  submit(token: string,buyerId: string,orderId: string,value: unknown) {
    const body=input(value);
    return this.store.transaction(s=>{
      const {order}=this.authorize(s,token,buyerId);
      if(order.id!==orderId) return fail('ACCESS_DENIED',403);
      if(!order.productIds.includes(body.productId)) return fail('PRODUCT_NOT_IN_ORDER',403);
      const existing=s.reviews.find(r=>r.orderId===orderId && r.productId===body.productId);
      if(existing) {
        if(existing.rating!==body.rating || existing.text!==body.text) return fail('REVIEW_CONFLICT',409);
        return {review:existing,replayed:true};
      }
      const review: Review={id:randomUUID(),...body,orderId,createdAt:this.now(),synthetic:true,mockVerified:true,source:{kind:'order',name:'합성 테스트 주문',sourceId:orderId,rightsConfirmed:true}};
      s.reviews.push(review); return {review,replayed:false};
    });
  }
  importRows(rows: ImportRow[]) {
    if(!Array.isArray(rows) || rows.length>10) return fail('IMPORT_LIMIT');
    return this.store.transaction(s=>{
      let imported=0,skipped=0,quarantined=0;
      const quarantine=(row: ImportRow,reason: string)=>{
        const key=digest(`${reason}:${canonical(row)}`);
        if(!s.quarantine.some(q=>q.key===key)) {s.quarantine.push({key,reason,row:structuredClone(row),createdAt:this.now()});quarantined++;} else skipped++;
      };
      for(const row of rows) {
        if(row.synthetic!==true || row.rightsConfirmed!==true || !row.sourceName?.trim() || !row.sourceId?.trim() || !row.sourceProductId?.trim()) {quarantine(row,'RIGHTS_OR_SOURCE_UNCONFIRMED');continue;}
        const productId=this.platform.mapProduct(row.sourceProductId);
        if(!productId) {quarantine(row,'PRODUCT_MAPPING_FAILED');continue;}
        try {input({productId,rating:row.rating,text:row.text});} catch {quarantine(row,'INPUT_INVALID');continue;}
        const existing=s.reviews.find(r=>r.source.kind==='import' && r.source.name===row.sourceName && r.source.sourceId===row.sourceId);
        if(existing) {if(existing.source.original && canonical(existing.source.original)===canonical(row)) skipped++; else quarantine(row,'SOURCE_ID_CONFLICT');continue;}
        if(s.reviews.some(r=>r.source.kind==='import' && r.source.name===row.sourceName && r.productId===productId && r.rating===row.rating && content(r.text)===content(row.text))) {quarantine(row,'AMBIGUOUS_DUPLICATE');continue;}
        s.reviews.push({id:randomUUID(),productId,rating:row.rating,text:row.text.trim(),createdAt:this.now(),synthetic:true,mockVerified:false,source:{kind:'import',name:row.sourceName,sourceId:row.sourceId,sourceProductId:row.sourceProductId,rightsConfirmed:true,original:structuredClone(row)}}); imported++;
      }
      return {imported,skipped,quarantined};
    });
  }
  admin() { const s=this.store.read(); return {requests:s.requests,reviews:s.reviews,quarantine:s.quarantine,orders:this.platform.orders(),products:this.platform.products(),synthetic:true}; }
  widget(productId: string) {
    if(!this.platform.products().some(p=>p.id===productId)) return fail('PRODUCT_NOT_FOUND',404);
    return this.store.read().reviews.filter(r=>r.productId===productId).map(r=>({id:r.id,rating:r.rating,text:r.text,synthetic:true,badge:r.mockVerified?'테스트 주문 확인 · 합성 데이터':'가져온 합성 리뷰 · 구매 미검증',source:r.source.kind==='import'?`${r.source.name} / ${r.source.sourceId}`:'합성 테스트 주문'}));
  }
  products() {return this.platform.products();}
}
