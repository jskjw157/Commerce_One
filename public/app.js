const app = document.querySelector('#app');
const errorMessages = {
  SESSION_REQUIRED: '데모 세션을 먼저 시작해 주세요.',
  ORDER_HELD: '부분 배송·취소·반품·미결제 주문은 요청을 보류합니다.',
  ACCESS_DENIED: '이 주문의 합성 구매자만 접근할 수 있습니다.',
  LINK_INVALID: '유효하지 않은 테스트 링크입니다. 관리자 화면에서 링크를 확인해 주세요.',
  LINK_EXPIRED: '테스트 링크가 만료되었습니다. 이 데모에서는 링크를 재발급하지 않습니다.',
  PRODUCT_NOT_IN_ORDER: '이 주문에 포함되지 않은 상품입니다.',
  REVIEW_CONFLICT: '이미 작성한 상품입니다. 기존 리뷰를 덮어쓰지 않았습니다.',
  INPUT_INVALID: '입력 내용을 확인해 주세요. 리뷰는 3~1,000자, 별점은 1~5점입니다.',
  INTERNAL_ERROR: '저장하지 못했습니다. 입력을 유지한 상태로 다시 시도해 주세요.',
};
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) { const error = new Error(errorMessages[result.error] || '요청을 처리하지 못했습니다. 다시 시도해 주세요.'); error.code = result.error; throw error; }
  return result;
}
function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
function link(text, href, cls) { const node = el('a', text, cls); node.href = href; return node; }
function button(text, fn, cls = 'button primary') { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
function heading(eyebrow, title, description) { const h = el('section', undefined, 'page-heading'); h.append(el('p', eyebrow, 'eyebrow'), el('h1', title), el('p', description, 'lede')); return h; }
function notice() { const n = el('div', '', 'notice'); n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); return n; }
function report(node, message, error = false) { node.textContent = message; node.className = error ? 'notice error' : 'notice success'; node.setAttribute('role', error ? 'alert' : 'status'); }
async function busy(b, fn, target) { b.disabled = true; try { await fn(); } catch (e) { report(target, e.message, true); } finally { b.disabled = false; } }
async function login(role, buyerId = 'SYN-BUYER-A') { await api('/api/demo/login', { role, buyerId }); }

function home() {
  app.className = 'home';
  const hero = heading('CONNECTED REVIEWS, ONE SMALL STEP', '리뷰가 이어지는\n가장 작은 흐름.', '배송이 끝난 테스트 주문에서 리뷰를 작성하고,\n그 이야기가 상품에 연결되는 순간까지 확인해 보세요.');
  hero.classList.add('hero');
  const actions = el('div', undefined, 'actions'); const status = notice();
  const admin = button('관리자 데모 열기', () => busy(admin, async () => { await login('admin'); location.href = '/admin'; }, status));
  actions.append(admin, link('상품 상세 미리보기 ↗', '/products/SYN-P-100', 'button secondary')); hero.append(actions, status);
  const visual = el('div', undefined, 'flow-visual');
  const note = el('div', undefined, 'floating-note'); note.append(el('span', '✓', 'check'), el('div', '주문에서 시작한 리뷰'), el('small', '상품에 올바르게 연결되었습니다'));
  const sheet = el('div', undefined, 'visual-sheet'); sheet.append(el('p', 'REVIEW CONNECTION', 'eyebrow'), el('div', '하나의 주문.\n두 상품의 이야기.', 'sheet-title'), el('div', '01  배송 완료 확인', 'flow-step'), el('div', '02  주문 상품 리뷰 작성', 'flow-step'), el('div', '03  상품 상세 노출', 'flow-step active'));
  visual.append(sheet, note);
  const intro = el('div', undefined, 'hero-grid'); intro.append(hero, visual); app.replaceChildren(intro);
  const strip = el('div', undefined, 'scope-strip'); strip.append(el('strong', '이번 파일럿에서 확인할 것'), el('span', '주문별 한 번의 요청'), el('span', '주문 상품에만 작성'), el('span', '출처를 지키는 가져오기')); app.append(strip);
  const section = el('section', undefined, 'home-bottom'); section.append(el('p', '작게 검증하고, 분명하게 남깁니다.', 'section-title'), el('p', '요청 기록·리뷰 저장·상품 노출을 각각 확인합니다. 카페24 연동과 실제 구매 검증은 아직 실행하지 않았습니다.', 'muted')); app.append(section);
}
async function admin() {
  app.className = 'dashboard';
  app.replaceChildren(heading('REVIEW OPERATIONS', '리뷰 파일럿 관리', '합성 주문의 요청 기록과 리뷰 연결 상태를 한곳에서 확인합니다.'));
  let data;
  try { data = await api('/api/admin'); }
  catch {
    const status = notice();
    const b = button('합성 관리자 시작', () => busy(b, async () => { await login('admin'); await admin(); }, status));
    app.append(el('p', '로컬 데모용 관리자 세션을 시작합니다. 실제 관리자 인증이 아닙니다.', 'muted'), b, status); return;
  }
  const status = notice();
  const metrics = el('section', undefined, 'metrics');
  for (const [label, value, sub] of [['요청 기록', data.requests.length, '발송하지 않은 테스트 링크'], ['저장된 리뷰', data.reviews.length, '합성 데이터만 저장'], ['검토 대기', data.quarantine.length, '매핑·중복 확인 필요']]) {
    const card = el('div', undefined, 'metric'); card.append(el('p', label), el('strong', String(value)), el('small', sub)); metrics.append(card);
  }
  const linkBox = el('div', undefined, 'link-box');
  const orders = el('section', undefined, 'panel'); orders.append(el('h2', '01  주문과 요청 기록'), el('p', '완전 배송·결제 완료 주문만 요청할 수 있습니다. 동일 주문을 다시 처리해도 기록은 늘지 않습니다.', 'muted'));
  const list = el('div', undefined, 'order-list');
  const labels = { delivered: '배송 완료', partial: '부분 배송 · 보류', cancelled: '취소 · 보류', returned: '반품 · 보류' };
  for (const order of data.orders) {
    const row = el('div', undefined, 'order-row'); const detail = el('div');
    detail.append(el('strong', order.id), el('small', `${order.buyerId} · ${order.productIds.length}개 상품`, 'muted'));
    const badge = el('span', order.paid ? labels[order.status] : '미결제 · 보류', order.status === 'delivered' && order.paid ? 'badge' : 'badge held');
    const b = button('요청 기록 생성', () => busy(b, async () => {
      const result = await api('/api/admin/requests', { orderId: order.id });
      linkBox.replaceChildren(el('strong', result.replayed ? '기존 요청을 다시 확인했습니다.' : '테스트 요청 기록을 만들었습니다.'), el('p', '고객에게 발송되지 않습니다. 작성 화면에서 일치하는 합성 구매자를 선택하세요.', 'muted'), link('테스트 작성 링크 열기', `/write#${result.token}`, 'button secondary'), el('small', `유효기간: ${new Date(result.request.expiresAt).toLocaleString('ko-KR')} · 7일 / 상품별 1회`));
      const current = await api('/api/admin'); metrics.querySelector('strong').textContent = String(current.requests.length);
      report(status, result.replayed ? '기존 요청 1건을 유지했습니다. 새 발송이나 추가 생성은 없습니다.' : '요청 기록 1건 생성 · 실제 발송 0건');
    }, status), 'button small secondary');
    b.setAttribute('aria-label', `요청 기록 생성 ${order.id}`); row.append(detail, badge, b); list.append(row);
  }
  orders.append(list, linkBox);
  const reviews = el('section', undefined, 'panel'); reviews.dataset.testid = 'admin-reviews'; reviews.append(el('h2', '02  리뷰와 상품 연결'));
  if (!data.reviews.length) reviews.append(el('p', '아직 저장된 리뷰가 없습니다. 테스트 링크에서 첫 리뷰를 작성해 보세요.', 'empty'));
  for (const review of data.reviews) {
    const row = el('article', undefined, 'review-row'); row.append(el('span', '★'.repeat(review.rating), 'stars'), el('p', review.text), link(data.products.find(p => p.id === review.productId)?.name || review.productId, `/products/${review.productId}`), el('small', `${review.mockVerified ? '테스트 주문 확인 · 합성 데이터' : '가져온 합성 리뷰 · 구매 미검증'} / ${review.source.name} / ${review.source.sourceId}`, 'muted')); reviews.append(row);
  }
  const imports = el('section', undefined, 'panel'); imports.append(el('h2', '03  작은 표본으로 가져오기'), el('p', '이용 권한 확인으로 표시된 합성 텍스트 원본 4행만 사용합니다. 정상 2행, 상품 매핑 실패 1행, 중복 불명확 1행입니다.', 'muted'));
  const importButton = button('권한 확인된 합성 표본 가져오기', () => busy(importButton, async () => {
    const result = await api('/api/admin/import', {}); await admin(); report(app.querySelector('[role=status]'), `가져오기 ${result.imported}건 · 검토 추가 ${result.quarantined}건 · 재처리 제외 ${result.skipped}건`);
  }, status), 'button secondary'); imports.append(importButton);
  const quarantine = el('div', undefined, 'quarantine'); quarantine.dataset.testid = 'quarantine';
  const reasons = { PRODUCT_MAPPING_FAILED: '상품 매핑 실패', AMBIGUOUS_DUPLICATE: '중복 불명확', SOURCE_ID_CONFLICT: '원본 ID 충돌', RIGHTS_OR_SOURCE_UNCONFIRMED: '권한·출처 미확인', INPUT_INVALID: '입력 오류' };
  for (const q of data.quarantine) { const row = el('div', undefined, 'quarantine-row'); row.append(el('span', reasons[q.reason] || q.reason, 'badge held'), el('span', `${q.row.sourceName} / ${q.row.sourceId}`), el('small', q.row.sourceProductId)); quarantine.append(row); }
  imports.append(quarantine); app.append(metrics, status, orders, reviews, imports);
}
async function write() {
  app.className = 'write-page';
  const token = location.hash.slice(1);
  const top = heading('YOUR TEST ORDER, YOUR REVIEW', '주문에서 시작하는 리뷰', '합성 구매자 세션과 주문 링크를 함께 확인합니다. 실제 구매자 인증은 아닙니다.');
  const status = notice();
  app.replaceChildren(top);
  if (!token) {report(status, '테스트 작성 링크가 없습니다. 관리자 화면에서 링크를 생성해 주세요.', true);app.append(status, link('관리자로 돌아가기', '/admin', 'button secondary'));return;}
  const gate = el('section', undefined, 'panel identity'); const label = el('label', '합성 구매자'); label.htmlFor = 'buyer';
  const select = el('select'); select.id = 'buyer';
  for (const id of ['SYN-BUYER-A', 'SYN-BUYER-B']) { const o = el('option', id === 'SYN-BUYER-A' ? '테스트 구매자 A · SYN-O-100' : '테스트 구매자 B · SYN-O-200'); o.value = id;select.append(o); }
  const b = button('합성 구매자로 확인', () => busy(b, async () => {
    await login('buyer', select.value); const order = await api('/api/review-link', { token }); renderForm(order);
  }, status)); gate.append(label, select, b); app.append(gate, status);
  function renderForm(order) {
    app.replaceChildren(heading('THANK YOU FOR YOUR STORY', '구매한 상품의 이야기를 들려주세요', '여기에 작성하는 내용은 개발용 합성 리뷰로 표시됩니다. 실제 개인정보나 고객 리뷰를 입력하지 마세요.'));
    const panel = el('section', undefined, 'panel review-form'); const summary = el('div', undefined, 'order-summary');
    summary.append(el('span', order.orderId), el('span', order.status === 'consumed' ? '모든 상품 작성 완료' : '테스트 주문 확인', 'badge')); panel.append(summary);
    if (order.status === 'consumed') {panel.append(el('p', '모든 상품의 리뷰가 저장되었습니다. 이 링크에서 새 리뷰를 추가하거나 기존 리뷰를 수정할 수 없습니다.'),link('상품 상세에서 확인', `/products/${order.products[0].id}`, 'button secondary'));app.append(panel);return;}
    const form = el('form');
    const productLabel = el('label', '리뷰 상품'); productLabel.htmlFor = 'product'; const product = el('select'); product.id = 'product';
    for (const p of order.products) {const o = el('option', `${p.name}${p.submitted ? ' · 작성 완료' : ''}`);o.value = p.id;o.disabled = p.submitted; product.append(o);}
    product.value = order.products.find(p => !p.submitted).id;
    const ratingLabel = el('label', '별점'); ratingLabel.htmlFor = 'rating';const rating = el('select');rating.id = 'rating';for (let n = 5; n >= 1; n--) {const o = el('option', `${'★'.repeat(n)} · ${n}점`);o.value = String(n);rating.append(o);}
    const textLabel = el('label', '리뷰 내용');textLabel.htmlFor = 'review-text';const text = el('textarea');text.id = 'review-text';text.required = true;text.minLength = 3;text.maxLength = 1000;text.rows = 6;text.placeholder = '[합성 테스트] 상품에 대한 테스트 문장을 적어 주세요.';
    const note = el('p', '3~1,000자 · 상품별 1회 · 저장 후 수정 불가 · 링크 생성 후 7일', 'muted form-help');const formStatus = notice();const result = el('div', undefined, 'save-result');
    const submit = el('button', '테스트 리뷰 저장', 'button primary');submit.type = 'submit';
    form.addEventListener('submit', event => {event.preventDefault();void busy(submit, async () => {
      const saved = await api(`/api/orders/${order.orderId}/reviews`, { token, review: { productId: product.value, rating: Number(rating.value), text: text.value } });
      report(formStatus, saved.replayed ? '이미 저장된 리뷰를 확인했습니다. 추가 등록은 없습니다.' : '리뷰가 저장되었습니다. 상품 연결을 확인해 보세요.');
      result.replaceChildren(link('상품 상세에서 확인', `/products/${saved.productId}`, 'button secondary'),button('다른 주문 상품 확인', async () => {try {renderForm(await api('/api/review-link', {token}));} catch(e) {report(formStatus,e.message,true);}},'button text-button'));
      submit.disabled = true;
    }, formStatus).then(() => {if (result.childElementCount) submit.disabled = true;});});
    form.append(productLabel, product, ratingLabel, rating, textLabel, text, note, submit, formStatus, result); panel.append(form); app.append(panel);
  }
}
async function product() {
  app.className = 'product-page'; const id = location.pathname.split('/').pop(); const products = await api('/api/public/products'); const p = products.find(p => p.id === id);
  if (!p) {app.replaceChildren(heading('NOT FOUND', '테스트 상품이 없습니다', '상품 미리보기에서 다시 선택해 주세요.'));return;}
  const breadcrumb = el('p', '상품 미리보기 / 라이프스타일', 'eyebrow');const grid = el('section', undefined, 'product-grid');
  const art = el('div', undefined, `product-art ${id === 'SYN-P-200' ? 'pouch' : ''}`);art.setAttribute('role', 'img');art.setAttribute('aria-label', '합성 상품을 나타내는 장식 일러스트'); art.append(el('div', undefined, 'product-object'), el('small', 'SYNTHETIC PRODUCT / LOCAL PREVIEW'));
  const detail = el('div', undefined, 'product-detail');detail.append(el('p', 'COMMERCE ONE / TEST COLLECTION', 'eyebrow'), el('h1', p.name), el('p', p.description, 'lede'),el('p', `${p.price.toLocaleString('ko-KR')}원`, 'price'),el('p', '표시 가격과 상품은 테스트 자료이며 결제되지 않습니다.', 'muted'));
  const purchaseStatus = notice();const actions = el('div', undefined, 'purchase-actions');actions.append(button('장바구니 담기 · 시뮬레이션', () => report(purchaseStatus, '장바구니 시뮬레이션 완료 · 주문이나 결제가 생성되지 않았습니다.'), 'button secondary'),button('구매하기 · 시뮬레이션', () => report(purchaseStatus, '구매 시뮬레이션 완료 · 실제 결제가 아닙니다.')));detail.append(actions, purchaseStatus); grid.append(art, detail);
  const reviews = el('section', undefined, 'panel storefront-reviews');reviews.append(el('div', 'REVIEWS', 'eyebrow'), el('h2', '이 상품의 이야기'),el('p', '합성 테스트 리뷰만 표시합니다. 가져온 리뷰의 출처와 검증 수준을 구분합니다.', 'muted'));
  const widget = el('div', '리뷰를 불러오는 중입니다.', 'widget');widget.dataset.testid = 'review-widget';widget.setAttribute('aria-live', 'polite');reviews.append(widget);
  app.replaceChildren(breadcrumb, grid, reviews);
  // The storefront purchase handlers above work without this optional module.
  import('/widget.js').then(module => module.mountReviews(widget, id)).catch(() => {widget.textContent = '리뷰를 불러오지 못했습니다. 상품 구매 시뮬레이션은 계속 이용할 수 있습니다.';});
}
try {if (location.pathname === '/admin') await admin();else if (location.pathname === '/write') await write();else if (location.pathname.startsWith('/products/')) await product();else home();}
catch (e) {const status = notice();report(status,e.message,true);app.replaceChildren(heading('LOCAL PILOT', '화면을 불러오지 못했습니다', '로컬 서버 상태를 확인하고 다시 시도해 주세요.'),status,link('처음으로','/','button secondary'));}
// Navigating between fragment-only links must not reuse a previously captured token.
window.addEventListener('hashchange', () => {if (location.pathname === '/write') void write();});
