import type { ImportRow, Order, OrderStatus, Platform, Product } from './types.js';
const products: Product[] = [
  {id:'SYN-P-100',name:'테스트 데일리 머그',description:'손에 편안하게 감기는 형태를 시험하는 합성 상품입니다.',price:18000},
  {id:'SYN-P-200',name:'테스트 린넨 파우치',description:'가벼운 소지품을 담는 합성 상품입니다.',price:12000},
  {id:'SYN-P-300',name:'테스트 유리 화병',description:'대상 외 상품 접근을 검증하는 합성 상품입니다.',price:24000},
];
export class MockPlatform implements Platform {
  private data: Order[] = [
    {id:'SYN-O-100',buyerId:'SYN-BUYER-A',status:'delivered',paid:true,synthetic:true,productIds:['SYN-P-100','SYN-P-200']},
    {id:'SYN-O-200',buyerId:'SYN-BUYER-B',status:'delivered',paid:true,synthetic:true,productIds:['SYN-P-300']},
    ...(['partial','cancelled','returned'] as const).map(status=>({id:`SYN-O-${status.toUpperCase()}`,buyerId:'SYN-BUYER-A',status,paid:true,synthetic:true as const,productIds:['SYN-P-100']})),
    {id:'SYN-O-UNPAID',buyerId:'SYN-BUYER-A',status:'delivered',paid:false,synthetic:true,productIds:['SYN-P-100']},
  ];
  products() { return structuredClone(products); }
  orders() { return structuredClone(this.data); }
  getOrder(id: string) { return this.orders().find(o=>o.id===id); }
  mapProduct(id: string) { return ({'SKU-SYN-100':'SYN-P-100','SKU-SYN-200':'SYN-P-200'} as Record<string,string>)[id]; }
  holdOrder(id: string, status: OrderStatus) { const o=this.data.find(o=>o.id===id); if(o) o.status=status; }
}
export const importFixture: ImportRow[] = [
  {synthetic:true,sourceName:'합성 원본 A',sourceId:'SYN-R-001',sourceProductId:'SKU-SYN-100',rightsConfirmed:true,rating:4,text:'[합성 리뷰] 손잡이가 편안하다는 테스트 문장입니다.'},
  {synthetic:true,sourceName:'합성 원본 A',sourceId:'SYN-R-002',sourceProductId:'SKU-SYN-200',rightsConfirmed:true,rating:5,text:'[합성 리뷰] 파우치 크기 확인용 테스트 문장입니다.'},
  {synthetic:true,sourceName:'합성 원본 A',sourceId:'SYN-R-003',sourceProductId:'UNKNOWN-SKU',rightsConfirmed:true,rating:3,text:'[합성 리뷰] 상품 매핑 실패 표본입니다.'},
  {synthetic:true,sourceName:'합성 원본 A',sourceId:'SYN-R-004',sourceProductId:'SKU-SYN-100',rightsConfirmed:true,rating:4,text:'[합성 리뷰] 손잡이가 편안하다는 테스트 문장입니다.'},
];
