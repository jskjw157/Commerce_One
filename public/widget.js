export async function mountReviews(root, productId) {
  try {
    const response = await fetch(`/api/public/products/${encodeURIComponent(productId)}/reviews`);
    if (!response.ok) throw new Error('REVIEWS_UNAVAILABLE');
    const rows = await response.json();
    root.replaceChildren();
    if (!rows.length) {const empty = document.createElement('p');empty.className = 'empty';empty.textContent = '아직 연결된 테스트 리뷰가 없습니다.';root.append(empty);return;}
    for (const row of rows) {
      const article = document.createElement('article');article.className = 'review-row';
      for (const [tag,text,cls] of [['span','★'.repeat(row.rating),'stars'],['p',row.text,'review-text'],['span',row.badge,'badge'],['small',`출처: ${row.source}`,'muted']]) {
        const child = document.createElement(tag);child.textContent = text;child.className = cls;article.append(child);
      }
      root.append(article);
    }
  } catch {
    root.textContent = '리뷰를 불러오지 못했습니다. 상품 구매 시뮬레이션은 계속 이용할 수 있습니다.';
  }
}
