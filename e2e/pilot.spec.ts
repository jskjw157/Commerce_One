import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHmac, randomBytes } from 'node:crypto';

type LocalPilot={origin:string;dir:string};
const test=base.extend<{pilot:LocalPilot}>({
  pilot:async ({},use,testInfo)=>{
    const dir=mkdtempSync(join(tmpdir(),'commerce-e2e-'));const port=4500+testInfo.workerIndex;
    if(testInfo.title.startsWith('expired link')) {
      const now=Date.now();
      writeFileSync(join(dir,'state.json'),JSON.stringify({version:1,synthetic:true,secret:randomBytes(32).toString('hex'),requests:[{id:'SYN-EXPIRED-REQUEST',orderId:'SYN-O-100',createdAt:now-8*86400000,expiresAt:now-86400000,synthetic:true}],reviews:[],quarantine:[]}),{mode:0o600});
    }
    const child=spawn(process.execPath,['dist/src/main.js'],{env:{...process.env,PORT:String(port),PILOT_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();});
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timed out '+errors)),10000);child.once('exit',()=>{clearTimeout(timer);reject(new Error('startup failed '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
    try {await use({origin:`http://127.0.0.1:${port}`,dir});}
    finally {child.kill('SIGTERM');await once(child,'exit');rmSync(dir,{recursive:true,force:true});}
  }
});
test.beforeEach(async({context,pilot})=>{
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===pilot.origin?route.continue():route.abort('blockedbyclient');});
});
async function requestLink(page: import('@playwright/test').Page,origin:string) {
  await page.goto(origin);await page.getByRole('button',{name:'관리자 데모 열기'}).click();
  await expect(page.getByRole('heading',{name:'리뷰 파일럿 관리'})).toBeVisible();
  await page.getByRole('button',{name:'요청 기록 생성 SYN-O-100'}).click();
  const link=page.getByRole('link',{name:'테스트 작성 링크 열기'});await expect(link).toBeVisible();return (await link.getAttribute('href'))!;
}
test('request, repeat click, write/save, product widget, admin and import provenance',async({page,pilot},testInfo)=>{
  const link=await requestLink(page,pilot.origin);
  await page.getByRole('button',{name:'요청 기록 생성 SYN-O-100'}).click();await expect(page.getByRole('status')).toContainText('기존 요청');
  await page.goto(pilot.origin+link);await page.getByRole('button',{name:'합성 구매자로 확인'}).click();
  await expect(page.getByRole('heading',{name:'구매한 상품의 이야기를 들려주세요'})).toBeVisible();
  await expect(page.getByLabel('리뷰 상품')).toHaveCount(1);
  await page.getByLabel('리뷰 내용').fill('[합성 E2E] <img src=x onerror="window.pwned=1"> 편안한 머그입니다.');
  await page.route('**/api/orders/SYN-O-100/reviews',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"INTERNAL_ERROR"}'}));
  await page.getByRole('button',{name:'테스트 리뷰 저장'}).click();
  await expect(page.getByRole('alert')).toContainText('저장하지 못했습니다');
  await expect(page.getByLabel('리뷰 내용')).toHaveValue(/\[합성 E2E\]/);
  await page.unroute('**/api/orders/SYN-O-100/reviews');
  await page.getByRole('button',{name:'테스트 리뷰 저장'}).click();await expect(page.getByRole('status')).toContainText('저장되었습니다');
  mkdirSync('output/playwright/screenshots',{recursive:true});
  await page.screenshot({path:`output/playwright/screenshots/${testInfo.project.name}-write.png`,fullPage:true});
  await page.getByRole('link',{name:'상품 상세에서 확인'}).click();
  await expect(page.getByTestId('review-widget')).toContainText('[합성 E2E] <img');
  await expect(page.getByText('테스트 주문 확인 · 합성 데이터',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>Object.hasOwn(window,'pwned'))).toBe(false);
  await page.getByRole('button',{name:'장바구니 담기 · 시뮬레이션'}).click();await expect(page.getByRole('status')).toContainText('장바구니 시뮬레이션');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  mkdirSync('output/playwright/screenshots',{recursive:true});
  await page.screenshot({path:`output/playwright/screenshots/${testInfo.project.name}-product.png`,fullPage:true});
  await page.goto(pilot.origin+'/products/SYN-P-300');await expect(page.getByTestId('review-widget')).not.toContainText('[합성 E2E]');
  await page.goto(pilot.origin+'/admin');await expect(page.getByTestId('admin-reviews')).toContainText('[합성 E2E]');
  await page.getByRole('button',{name:'권한 확인된 합성 표본 가져오기'}).click();await expect(page.getByRole('status')).toContainText('가져오기 2건');
  await expect(page.getByTestId('quarantine')).toContainText('상품 매핑 실패');await expect(page.getByTestId('quarantine')).toContainText('중복 불명확');
  await page.getByRole('button',{name:'권한 확인된 합성 표본 가져오기'}).click();await expect(page.getByRole('status')).toContainText('가져오기 0건');
  await page.screenshot({path:`output/playwright/screenshots/${testInfo.project.name}-admin.png`,fullPage:true});
  await page.goto(pilot.origin+'/products/SYN-P-100');await expect(page.getByTestId('review-widget')).toContainText('가져온 합성 리뷰 · 구매 미검증');await expect(page.getByTestId('review-widget')).toContainText('합성 원본 A / SYN-R-001');
});
test('invalid/wrong buyer/missing links and held orders show recoverable errors',async({page,pilot})=>{
  const link=await requestLink(page,pilot.origin);
  await page.getByRole('button',{name:'요청 기록 생성 SYN-O-PARTIAL'}).click();await expect(page.getByRole('alert')).toContainText('보류');
  await page.goto(pilot.origin+link+'x');await page.getByRole('button',{name:'합성 구매자로 확인'}).click();await expect(page.getByRole('alert')).toContainText('유효하지 않은');
  await page.goto(pilot.origin+link);await page.getByLabel('합성 구매자').selectOption('SYN-BUYER-B');await page.getByRole('button',{name:'합성 구매자로 확인'}).click();await expect(page.getByRole('alert')).toContainText('구매자');
  const statePath=join(pilot.dir,'state.json');const state=JSON.parse(readFileSync(statePath,'utf8'));
  expect(state.requests).toHaveLength(1);
  await page.goto(pilot.origin+'/write');await expect(page.getByRole('alert')).toContainText('링크');
});
test('widget outage and script failure leave simulated cart and checkout independent',async({page,pilot})=>{
  await page.route('**/api/public/products/SYN-P-100/reviews',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"SYNTHETIC_OUTAGE"}'}));
  await page.goto(pilot.origin+'/products/SYN-P-100');await expect(page.getByTestId('review-widget')).toContainText('리뷰를 불러오지 못했습니다');
  await page.getByRole('button',{name:'장바구니 담기 · 시뮬레이션'}).click();await expect(page.getByRole('status')).toContainText('장바구니 시뮬레이션');
  await page.getByRole('button',{name:'구매하기 · 시뮬레이션'}).click();await expect(page.getByRole('status')).toContainText('구매 시뮬레이션');
  await page.unroute('**/api/public/products/SYN-P-100/reviews');await page.route('**/widget.js',route=>route.abort());
  await page.reload();await page.getByRole('button',{name:'구매하기 · 시뮬레이션'}).click();await expect(page.getByRole('status')).toContainText('구매 시뮬레이션');
});

test('expired link shows server expiry without adding a review',async({page,pilot})=>{
  const state=JSON.parse(readFileSync(join(pilot.dir,'state.json'),'utf8'));
  const r=state.requests[0];
  const token=r.id+'.'+createHmac('sha256',state.secret).update(JSON.stringify([r.id,r.orderId,r.expiresAt])).digest('hex');
  await page.goto(pilot.origin+'/write#'+token);
  await page.getByRole('button',{name:'합성 구매자로 확인'}).click();
  await expect(page.getByRole('alert')).toContainText('만료');
  expect(JSON.parse(readFileSync(join(pilot.dir,'state.json'),'utf8')).reviews).toHaveLength(0);
});
