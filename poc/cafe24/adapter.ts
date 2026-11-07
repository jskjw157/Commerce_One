import { isDeepStrictEqual } from 'node:util';

// Logical request descriptors, not HTTP requests. No host, token or live transport exists.
export interface FixtureRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: { 'X-Cafe24-Api-Version': string };
  query?: Record<string, string | number | string[]>;
  body?: unknown;
}

export interface FixtureExchange {
  request: FixtureRequest;
  response: { status: number; body: unknown };
}

export class AdapterError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Concrete in-memory transport only: an unmatched request fails; it never falls back to I/O.
export class FixtureTransport {
  #exchanges: FixtureExchange[];
  #requests: FixtureRequest[] = [];
  constructor(exchanges: FixtureExchange[]) {
    this.#exchanges = structuredClone(exchanges);
  }
  get requests(): FixtureRequest[] { return structuredClone(this.#requests); }
  send(request: FixtureRequest): FixtureExchange['response'] {
    this.#requests.push(structuredClone(request));
    const exchange = this.#exchanges.find(e => isDeepStrictEqual(e.request, request));
    if (!exchange) throw new AdapterError('FIXTURE_NOT_FOUND');
    return structuredClone(exchange.response);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdapterError('CONTRACT_INVALID');
  return value as Record<string, unknown>;
}
function rows(body: unknown, key: string): Record<string, unknown>[] {
  const value = object(body)[key];
  if (!Array.isArray(value)) throw new AdapterError('CONTRACT_INVALID');
  return value.map(object);
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new AdapterError('CONTRACT_INVALID');
  return value;
}
function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new AdapterError('CONTRACT_INVALID');
  return value;
}
function flag(value: unknown, allowed = ['T', 'F']): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new AdapterError('CONTRACT_INVALID');
  return value;
}
function syntheticOrderId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^SYN-[A-Z0-9-]{1,28}$/.test(value)) throw new AdapterError('INPUT_INVALID');
}

const claimDates = [
  'cancel_date', 'cancel_request_date', 'return_request_date', 'return_confirmed_date',
  'return_collected_date', 'refund_date', 'exchange_request_date', 'exchange_date',
] as const;

export interface ReviewInput {
  orderId: string;
  orderItemCode: string;
  productNo: number;
  title: string;
  content: string;
  rating: number;
}

export class Cafe24OfflineAdapter {
  #transport: FixtureTransport;
  #shopNo: number;
  #boardNo: number;
  constructor(transport: FixtureTransport, options: { shopNo: number; boardNo: number }) {
    this.#transport = transport;
    this.#shopNo = integer(options.shopNo);
    this.#boardNo = integer(options.boardNo);
  }

  #exchange(request: Omit<FixtureRequest, 'headers'>): unknown {
    const response = this.#transport.send({
      ...request, headers: { 'X-Cafe24-Api-Version': '2026-09-01' },
    });
    // No automatic retries, especially not POSTs. Never echo an error payload with customer data.
    if (response.status !== 200) throw new AdapterError('API_ERROR', response.status);
    return response.body;
  }

  assessOrder(orderId: string) {
    syntheticOrderId(orderId);
    const orders = rows(this.#exchange({
      method: 'GET', path: '/api/v2/admin/orders',
      query: { shop_no: this.#shopNo, order_id: [orderId] },
    }), 'orders');
    if (orders.length === 0) throw new AdapterError('ORDER_NOT_FOUND');
    const order = orders[0]!;
    if (orders.length !== 1 || order.order_id !== orderId || order.shop_no !== this.#shopNo) {
      throw new AdapterError('CONTRACT_INVALID');
    }
    const paid = flag(order.paid, ['T', 'F', 'M']);
    const canceled = flag(order.canceled, ['T', 'F', 'M']);
    const sourceItems = rows(this.#exchange({
      method: 'GET', path: `/api/v2/admin/orders/${orderId}/items`, query: { shop_no: this.#shopNo },
    }), 'items');
    const codes = new Set<string>();
    const items = sourceItems.map(item => {
      if (item.shop_no !== this.#shopNo) throw new AdapterError('CONTRACT_INVALID');
      const orderItemCode = text(item.order_item_code);
      if (codes.has(orderItemCode)) throw new AdapterError('CONTRACT_INVALID');
      codes.add(orderItemCode);
      const rawStatus = text(item.order_status);
      const claimQuantity = integer(item.claim_quantity, 0);
      if (item.claim_code !== null && typeof item.claim_code !== 'string') throw new AdapterError('CONTRACT_INVALID');
      const statusCode = text(item.status_code);
      const hasClaimDate = claimDates.map(key => {
        const date = item[key];
        // Requiring explicit null/empty values is a stricter fixture projection, not a Cafe24 required-field claim.
        if (date !== null && typeof date !== 'string') throw new AdapterError('CONTRACT_INVALID');
        return Boolean(date);
      }).some(Boolean);
      return {
        orderItemCode, productNo: integer(item.product_no), quantity: integer(item.quantity), rawStatus,
        delivered: rawStatus === 'N40' || rawStatus === 'N50',
        hasClaim: claimQuantity > 0 || Boolean(item.claim_code) || statusCode !== 'N1' || hasClaimDate,
        bundle: flag(item.product_bundle) === 'T',
      };
    });
    const reasons: string[] = [];
    if (paid !== 'T') reasons.push('UNPAID_OR_PARTIALLY_PAID');
    if (canceled !== 'F') reasons.push('CANCELED_OR_PARTIALLY_CANCELED');
    if (items.length === 0) reasons.push('NO_ITEMS');
    if (items.length >= 100) reasons.push('ITEM_LIMIT_COMPLETENESS_UNVERIFIED');
    if (items.some(item => !item.delivered)) reasons.push('ITEM_NOT_DELIVERED_OR_UNKNOWN_STATUS');
    if (items.some(item => item.hasClaim)) reasons.push('CLAIM_PRESENT');
    if (items.some(item => item.bundle)) reasons.push('BUNDLE_MAPPING_UNSUPPORTED');
    return { synthetic: true as const, orderId, items, eligible: reasons.length === 0, reasons, buyerAuthenticated: false as const };
  }

  saveReview(input: ReviewInput) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 256
      || typeof input.content !== 'string' || !input.content.trim() || input.content.trim().length > 1000
      || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5
      || !Number.isSafeInteger(input.productNo) || input.productNo < 1 || input.productNo > 2147483647
      || typeof input.orderItemCode !== 'string') throw new AdapterError('INPUT_INVALID');
    const order = this.assessOrder(input.orderId);
    if (!order.eligible) throw new AdapterError('ORDER_HELD');
    if (!order.items.some(item => item.orderItemCode === input.orderItemCode && item.productNo === input.productNo)) {
      throw new AdapterError('PRODUCT_NOT_IN_ORDER');
    }
    const title = input.title.trim();
    const content = input.content.trim();
    const result = rows(this.#exchange({
      method: 'POST', path: `/api/v2/admin/boards/${this.#boardNo}/articles`,
      body: { shop_no: this.#shopNo, requests: [{
        writer: 'Synthetic fixture author', title, content, client_ip: '127.0.0.1',
        product_no: input.productNo, order_id: input.orderId, rating: input.rating,
      }] },
    }), 'articles');
    const article = result[0];
    if (result.length !== 1 || !article || article.shop_no !== this.#shopNo || article.board_no !== this.#boardNo
      || article.product_no !== input.productNo || article.order_id !== input.orderId
      || article.rating !== input.rating || article.title !== title || article.content !== content) {
      throw new AdapterError('LINKAGE_MISMATCH');
    }
    return {
      synthetic: true as const, articleNo: integer(article.article_no), productNo: input.productNo,
      acceptance: 'fixture-response-only' as const,
      buyerAuthenticated: false as const, nativePurchaseBadge: 'unverified' as const,
      storefrontDisplay: 'unverified' as const,
    };
  }

  listProductReviews(productNo: number) {
    integer(productNo);
    const articles = rows(this.#exchange({
      method: 'GET', path: `/api/v2/admin/boards/${this.#boardNo}/articles`,
      query: { shop_no: this.#shopNo, product_no: productNo, is_display: 'T', limit: 100, offset: 0 },
    }), 'articles');
    const seen = new Set<number>();
    const reviews = articles.flatMap(article => {
      if (article.shop_no !== this.#shopNo || article.board_no !== this.#boardNo) throw new AdapterError('CONTRACT_INVALID');
      const articleNo = integer(article.article_no);
      if (seen.has(articleNo)) throw new AdapterError('CONTRACT_INVALID');
      seen.add(articleNo);
      const linkedProductNo = integer(article.product_no, 0);
      const display = flag(article.display);
      const secret = flag(article.secret);
      const deleted = flag(article.deleted, ['T', 'F', 'B']);
      const rating = integer(article.rating, 0);
      if (rating > 5) throw new AdapterError('CONTRACT_INVALID');
      if (linkedProductNo !== productNo || display !== 'T' || secret !== 'F' || deleted !== 'F' || rating === 0) return [];
      return [{ articleNo, productNo, rating, title: text(article.title), content: text(article.content), synthetic: true as const }];
    });
    return {
      reviews, page: { offset: 0, limit: 100, mayHaveMore: articles.length >= 100 },
      nativePurchaseBadge: 'unverified' as const, storefrontDisplay: 'unverified' as const,
    };
  }
}
