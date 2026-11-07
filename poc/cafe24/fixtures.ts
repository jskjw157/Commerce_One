import type { FixtureExchange, ReviewInput } from './adapter.ts';

// Hand-authored synthetic projections of documented fields, NOT captured mall responses.
// Defaults (shop 1, product board 7, explicit no-claim fields) are local fixture assumptions.
export const reviewInput: ReviewInput = {
  orderId: 'SYN-O-100', orderItemCode: 'SYN-I-101-A', productNo: 101,
  title: '합성 후기', content: '실제 고객 후기가 아닌 오프라인 계약 테스트입니다.', rating: 4,
};

function item(orderItemCode: string, productNo: number, status: string, quantity: number) {
  return {
    shop_no: 1, order_item_code: orderItemCode, product_no: productNo, quantity,
    order_status: status, status_code: 'N1', product_bundle: 'F', claim_quantity: 0,
    claim_code: null as string | null,
    cancel_date: null as string | null, cancel_request_date: null as string | null,
    return_request_date: null as string | null, return_confirmed_date: null as string | null,
    return_collected_date: null as string | null, refund_date: null as string | null,
    exchange_request_date: null as string | null, exchange_date: null as string | null,
  };
}

export function fixtureSet() {
  const orders = { orders: [{
    shop_no: 1, order_id: 'SYN-O-100', paid: 'T', canceled: 'F',
    member_id: 'SYN-BUYER-A', member_email: 'synthetic@example.invalid',
  }] };
  const items = { items: [
    item('SYN-I-101-A', 101, 'N40', 2),
    item('SYN-I-202-B', 202, 'N50', 1),
    item('SYN-I-101-C', 101, 'N40', 1),
  ] };
  const article = {
    shop_no: 1, board_no: 7, article_no: 9001, product_no: 101, order_id: 'SYN-O-100',
    writer: 'Synthetic fixture author', member_id: 'SYN-BUYER-A', writer_email: 'synthetic@example.invalid',
    client_ip: '127.0.0.1', title: '합성 후기', content: '실제 고객 후기가 아닌 오프라인 계약 테스트입니다.',
    rating: 4, display: 'T', secret: 'F', deleted: 'F',
  };
  const created = { articles: [structuredClone(article)] };
  const listed = { articles: [
    article,
    { ...article, article_no: 9002, product_no: 202 },
    { ...article, article_no: 9003, display: 'F' },
    { ...article, article_no: 9004, secret: 'T' },
    { ...article, article_no: 9005, deleted: 'T' },
    { ...article, article_no: 9006, deleted: 'B' },
    { ...article, article_no: 9007, rating: 0 },
    { ...article, article_no: 9008, product_no: 0 },
  ] };
  const exchanges: FixtureExchange[] = [
    {
      request: {
        method: 'GET', path: '/api/v2/admin/orders',
        headers: { 'X-Cafe24-Api-Version': '2026-09-01' },
        query: { shop_no: 1, order_id: ['SYN-O-100'] },
      },
      response: { status: 200, body: orders },
    },
    {
      request: {
        method: 'GET', path: '/api/v2/admin/orders/SYN-O-100/items',
        headers: { 'X-Cafe24-Api-Version': '2026-09-01' }, query: { shop_no: 1 },
      },
      response: { status: 200, body: items },
    },
    {
      request: {
        method: 'POST', path: '/api/v2/admin/boards/7/articles',
        headers: { 'X-Cafe24-Api-Version': '2026-09-01' },
        body: { shop_no: 1, requests: [{
          writer: 'Synthetic fixture author', title: '합성 후기',
          content: '실제 고객 후기가 아닌 오프라인 계약 테스트입니다.', client_ip: '127.0.0.1',
          product_no: 101, order_id: 'SYN-O-100', rating: 4,
        }] },
      },
      response: { status: 200, body: created },
    },
    {
      request: {
        method: 'GET', path: '/api/v2/admin/boards/7/articles',
        headers: { 'X-Cafe24-Api-Version': '2026-09-01' },
        query: { shop_no: 1, product_no: 101, is_display: 'T', limit: 100, offset: 0 },
      },
      response: { status: 200, body: listed },
    },
  ];
  return { orders, items, created, listed, exchanges };
}
