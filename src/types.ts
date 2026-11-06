export interface Product { id: string; name: string; description: string; price: number; }
export type OrderStatus = 'delivered'|'partial'|'cancelled'|'returned';
export interface Order { id: string; buyerId: string; status: OrderStatus; paid: boolean; synthetic: true; productIds: string[]; }
export interface RequestRecord { id: string; orderId: string; createdAt: number; expiresAt: number; synthetic: true; }
export interface ImportRow { synthetic: boolean; sourceName: string; sourceId: string; sourceProductId: string; rightsConfirmed: boolean; rating: number; text: string; }
export interface Review {
  id: string; productId: string; orderId?: string; rating: number; text: string; createdAt: number; synthetic: true; mockVerified: boolean;
  source: { kind: 'order'|'import'; name: string; sourceId: string; sourceProductId?: string; rightsConfirmed: boolean; original?: ImportRow };
}
export interface Quarantine { key: string; reason: string; row: ImportRow; createdAt: number; }
export interface State { version: 1; synthetic: true; secret: string; requests: RequestRecord[]; reviews: Review[]; quarantine: Quarantine[]; }
export interface Platform { getOrder(id: string): Order | undefined; products(): Product[]; orders(): Order[]; mapProduct(sourceProductId: string): string | undefined; }
