import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdapterError, Cafe24OfflineAdapter, FixtureTransport } from './adapter.ts';
import type { ReviewInput } from './adapter.ts';
import { fixtureSet, reviewInput } from './fixtures.ts';

function setup(f = fixtureSet()) {
  const transport = new FixtureTransport(f.exchanges);
  return { adapter: new Cafe24OfflineAdapter(transport, { shopNo: 1, boardNo: 7 }), transport };
}
function rejects(action: () => unknown, code: string) {
  assert.throws(action, (error: unknown) => error instanceof AdapterError && error.code === code);
}

test('maps distinct order items and quantities, accepts N40/N50 without authenticating a buyer', () => {
  const { adapter } = setup();
  assert.deepEqual(adapter.assessOrder('SYN-O-100'), {
    synthetic: true, orderId: 'SYN-O-100', eligible: true, reasons: [], buyerAuthenticated: false,
    items: [
      { orderItemCode: 'SYN-I-101-A', productNo: 101, quantity: 2, rawStatus: 'N40', delivered: true, hasClaim: false, bundle: false },
      { orderItemCode: 'SYN-I-202-B', productNo: 202, quantity: 1, rawStatus: 'N50', delivered: true, hasClaim: false, bundle: false },
      { orderItemCode: 'SYN-I-101-C', productNo: 101, quantity: 1, rawStatus: 'N40', delivered: true, hasClaim: false, bundle: false },
    ],
  });
});

test('holds unpaid/partial payments and canceled/partial cancels despite delivered items', () => {
  for (const [field, value, reason] of [
    ['paid', 'F', 'UNPAID_OR_PARTIALLY_PAID'], ['paid', 'M', 'UNPAID_OR_PARTIALLY_PAID'],
    ['canceled', 'T', 'CANCELED_OR_PARTIALLY_CANCELED'], ['canceled', 'M', 'CANCELED_OR_PARTIALLY_CANCELED'],
  ] as const) {
    const f = fixtureSet(); f.orders.orders[0]![field] = value;
    const { adapter, transport } = setup(f);
    assert.deepEqual(adapter.assessOrder('SYN-O-100').reasons, [reason]);
    rejects(() => adapter.saveReview(reviewInput), 'ORDER_HELD');
    assert.equal(transport.requests.some(r => r.method === 'POST'), false);
  }
});

test('one pending/cancel/return/exchange/unknown item holds the whole mixed order', () => {
  for (const status of ['N00', 'N10', 'N20', 'N21', 'N22', 'N30', 'C00', 'C40', 'R00', 'R40', 'E00', 'E40', 'Z99']) {
    const f = fixtureSet(); f.items.items[1]!.order_status = status;
    const { adapter } = setup(f);
    assert.deepEqual(adapter.assessOrder('SYN-O-100').reasons, ['ITEM_NOT_DELIVERED_OR_UNKNOWN_STATUS'], status);
    rejects(() => adapter.saveReview(reviewInput), 'ORDER_HELD');
  }
});

test('claim evidence blocks even an N40 item with zero claimed quantity', () => {
  const changes: Record<string, unknown>[] = [
    { claim_quantity: 1 }, { claim_code: 'SYN-CLAIM-1' }, { status_code: 'N2' },
    ...['cancel_date', 'cancel_request_date', 'return_request_date', 'return_confirmed_date',
      'return_collected_date', 'refund_date', 'exchange_request_date', 'exchange_date']
      .map(key => ({ [key]: '2026-11-06T12:00:00+09:00' })),
  ];
  for (const change of changes) {
    const f = fixtureSet(); Object.assign(f.items.items[2]!, change);
    assert.deepEqual(setup(f).adapter.assessOrder('SYN-O-100').reasons, ['CLAIM_PRESENT']);
  }
});

test('empty items, bundles and the ambiguous 100-item cap are not considered fully delivered', () => {
  const empty = fixtureSet(); empty.items.items = [];
  assert.deepEqual(setup(empty).adapter.assessOrder('SYN-O-100').reasons, ['NO_ITEMS']);
  const bundle = fixtureSet(); bundle.items.items[0]!.product_bundle = 'T';
  assert.deepEqual(setup(bundle).adapter.assessOrder('SYN-O-100').reasons, ['BUNDLE_MAPPING_UNSUPPORTED']);
  for (const count of [99, 100]) {
    const f = fixtureSet();
    f.items.items = Array.from({ length: count }, (_, index) => ({ ...f.items.items[0]!, order_item_code: `SYN-I-${index}` }));
    const result = setup(f).adapter.assessOrder('SYN-O-100');
    assert.equal(result.eligible, count === 99);
    assert.deepEqual(result.reasons, count === 99 ? [] : ['ITEM_LIMIT_COMPLETENESS_UNVERIFIED']);
  }
});

test('rejects missing/malformed safety fields, string numeric IDs, duplicate item codes and wrong shops', () => {
  for (const change of [
    { order_status: undefined }, { claim_quantity: undefined }, { claim_quantity: -1 },
    { claim_code: undefined }, { cancel_request_date: undefined }, { status_code: undefined },
    { product_no: '101' }, { quantity: 0 }, { quantity: 1.5 }, { shop_no: 2 }, { product_bundle: 'unknown' },
  ]) {
    const f = fixtureSet(); Object.assign(f.items.items[0]!, change);
    rejects(() => setup(f).adapter.assessOrder('SYN-O-100'), 'CONTRACT_INVALID');
  }
  const duplicate = fixtureSet(); duplicate.items.items[1]!.order_item_code = 'SYN-I-101-A';
  rejects(() => setup(duplicate).adapter.assessOrder('SYN-O-100'), 'CONTRACT_INVALID');
  for (const body of [null, {}, { items: null }, { items: [null] }]) {
    const f = fixtureSet(); f.exchanges[1]!.response.body = body;
    rejects(() => setup(f).adapter.assessOrder('SYN-O-100'), 'CONTRACT_INVALID');
  }
});

test('never selects a different/ambiguous order or treats a missing order as eligible', () => {
  const missing = fixtureSet(); missing.orders.orders = [];
  rejects(() => setup(missing).adapter.assessOrder('SYN-O-100'), 'ORDER_NOT_FOUND');
  const duplicate = fixtureSet(); duplicate.orders.orders.push({ ...duplicate.orders.orders[0]! });
  rejects(() => setup(duplicate).adapter.assessOrder('SYN-O-100'), 'CONTRACT_INVALID');
  for (const change of [{ order_id: 'SYN-O-OTHER' }, { shop_no: 2 }, { paid: 'true' }, { canceled: undefined }]) {
    const f = fixtureSet(); Object.assign(f.orders.orders[0]!, change);
    rejects(() => setup(f).adapter.assessOrder('SYN-O-100'), 'CONTRACT_INVALID');
  }
});

test('builds the documented batch article envelope and checks its synthetic acceptance without claiming exposure', () => {
  const { adapter, transport } = setup();
  const result = adapter.saveReview({ ...reviewInput, title: '  합성 후기  ', content: ` ${reviewInput.content} ` });
  assert.deepEqual(result, {
    synthetic: true, articleNo: 9001, productNo: 101, acceptance: 'fixture-response-only',
    buyerAuthenticated: false, nativePurchaseBadge: 'unverified', storefrontDisplay: 'unverified',
  });
  assert.deepEqual(transport.requests.find(r => r.method === 'POST'), {
    method: 'POST', path: '/api/v2/admin/boards/7/articles', headers: { 'X-Cafe24-Api-Version': '2026-09-01' },
    body: { shop_no: 1, requests: [{
      writer: 'Synthetic fixture author', title: '합성 후기', content: '실제 고객 후기가 아닌 오프라인 계약 테스트입니다.',
      client_ip: '127.0.0.1', product_no: 101, order_id: 'SYN-O-100', rating: 4,
    }] },
  });
  assert.doesNotMatch(JSON.stringify(result), /SYN-BUYER|member_id|writer_email|client_ip|SYN-O-/);
});

test('binds product and item together, rather than accepting any product found elsewhere in the order', () => {
  for (const change of [{ productNo: 303 }, { productNo: 202 }, { orderItemCode: 'SYN-I-OTHER' }]) {
    const { adapter, transport } = setup();
    rejects(() => adapter.saveReview({ ...reviewInput, ...change }), 'PRODUCT_NOT_IN_ORDER');
    assert.equal(transport.requests.some(r => r.method === 'POST'), false);
  }
});

test('rejects invalid review inputs and real-looking IDs before any fixture exchange', () => {
  for (const input of [
    null, [], { ...reviewInput, rating: 0 }, { ...reviewInput, rating: 6 }, { ...reviewInput, rating: 2.5 },
    { ...reviewInput, title: '' }, { ...reviewInput, title: 'a'.repeat(257) },
    { ...reviewInput, content: ' ' }, { ...reviewInput, content: 'a'.repeat(1001) },
    { ...reviewInput, productNo: '101' }, { ...reviewInput, productNo: 2147483648 },
    { ...reviewInput, orderId: '20261106-0000001' }, { ...reviewInput, orderId: 'SYN-../../etc' },
  ]) {
    const { adapter, transport } = setup();
    rejects(() => adapter.saveReview(input as ReviewInput), 'INPUT_INVALID');
    assert.deepEqual(transport.requests, []);
  }
  for (const rating of [1, 5]) {
    const f = fixtureSet();
    const body = f.exchanges[2]!.request.body as { requests: Record<string, unknown>[] };
    const title = 'a'.repeat(256); const content = '한'.repeat(1000);
    Object.assign(body.requests[0]!, { title, content, rating });
    Object.assign(f.created.articles[0]!, { title, content, rating });
    assert.equal(setup(f).adapter.saveReview({ ...reviewInput, title, content, rating }).articleNo, 9001);
  }
});

test('a 200 response is not enough: rejects mismatched article identity, product, order, or saved content', () => {
  for (const change of [
    { shop_no: 2 }, { board_no: 8 }, { product_no: 202 }, { order_id: 'SYN-O-OTHER' },
    { rating: 3 }, { title: 'different' }, { content: 'different' },
  ]) {
    const f = fixtureSet(); Object.assign(f.created.articles[0]!, change);
    rejects(() => setup(f).adapter.saveReview(reviewInput), 'LINKAGE_MISMATCH');
  }
  for (const articles of [[], [fixtureSet().created.articles[0]!, fixtureSet().created.articles[0]!]]) {
    const f = fixtureSet(); f.created.articles = articles;
    rejects(() => setup(f).adapter.saveReview(reviewInput), 'LINKAGE_MISMATCH');
  }
});

test('exposes only same-product public non-secret non-deleted rated rows, with no customer or order metadata', () => {
  const result = setup().adapter.listProductReviews(101);
  assert.deepEqual(result, {
    reviews: [{ articleNo: 9001, productNo: 101, rating: 4, title: '합성 후기', content: '실제 고객 후기가 아닌 오프라인 계약 테스트입니다.', synthetic: true }],
    page: { offset: 0, limit: 100, mayHaveMore: false }, nativePurchaseBadge: 'unverified', storefrontDisplay: 'unverified',
  });
  assert.doesNotMatch(JSON.stringify(result), /SYN-BUYER|SYN-O-|member_id|writer_email|client_ip|order_id|127\.0\.0\.1/);
  const f = fixtureSet(); f.listed.articles = [{ ...f.listed.articles[0]!, content: '<script>unsafe()</script>' }];
  assert.equal(setup(f).adapter.listProductReviews(101).reviews[0]!.content, '<script>unsafe()</script>');
  // This is data, not rendered HTML. A future UI must escape it.
});

test('article listing fails closed on wrong board/shop, malformed flags, and duplicate IDs; marks full pages incomplete', () => {
  for (const change of [{ shop_no: 2 }, { board_no: 8 }, { secret: undefined }, { deleted: 'unknown' }, { rating: 6 }, { product_no: '101' }]) {
    const f = fixtureSet(); Object.assign(f.listed.articles[0]!, change);
    rejects(() => setup(f).adapter.listProductReviews(101), 'CONTRACT_INVALID');
  }
  const duplicate = fixtureSet(); duplicate.listed.articles.push({ ...duplicate.listed.articles[0]! });
  rejects(() => setup(duplicate).adapter.listProductReviews(101), 'CONTRACT_INVALID');
  const full = fixtureSet();
  full.listed.articles = Array.from({ length: 100 }, (_, i) => ({ ...full.listed.articles[0]!, article_no: 10000 + i }));
  const page = setup(full).adapter.listProductReviews(101);
  assert.equal(page.reviews.length, 100); assert.equal(page.page.mayHaveMore, true);
});

test('surfaces auth/validation/rate/server errors without leaking payloads or retrying writes', () => {
  for (const status of [201, 401, 403, 422, 429, 500]) {
    for (const index of [0, 1, 2, 3]) {
      const f = fixtureSet(); f.exchanges[index]!.response = { status, body: { error: 'SYN-BUYER-PRIVATE' } };
      const { adapter, transport } = setup(f);
      assert.throws(() => index === 3 ? adapter.listProductReviews(101) : adapter.saveReview(reviewInput),
        (error: unknown) => error instanceof AdapterError && error.code === 'API_ERROR'
          && error.status === status && !error.message.includes('PRIVATE'));
      assert.equal(transport.requests.filter(r => r.method === 'POST').length, index === 2 ? 1 : 0);
    }
  }
});

test('fixture transport has no unmatched-request fallback and returns isolated snapshots', () => {
  const f = fixtureSet(); const transport = new FixtureTransport(f.exchanges);
  rejects(() => transport.send({ method: 'GET', path: 'https://not-a-mall.invalid', headers: { 'X-Cafe24-Api-Version': '2026-09-01' } }), 'FIXTURE_NOT_FOUND');
  const first = transport.send(f.exchanges[0]!.request);
  (first.body as { orders: unknown[] }).orders.length = 0;
  assert.equal((transport.send(f.exchanges[0]!.request).body as { orders: unknown[] }).orders.length, 1);
});
