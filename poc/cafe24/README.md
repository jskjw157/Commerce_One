# Cafe24 비통신 어댑터 PoC / 인계 기록

**범위: 합성 fixture의 요청·응답 계약만 검증. 실몰 연동·구매자 인증·카페24 구매 배지·상품 상세 실제 노출은 미검증.**

2026-11-07 KST, Windows / Node 24.18.0에서 직접 구현·실행했다. 독립 clone의 로컬 브랜치는 `poc/cafe24-review-adapter`다. 원격 `origin/codex/review-pilot-mock`과 시작 HEAD는 [`fd97ee462ee16dd63c884035c5b8cbcb41ac2041`](https://github.com/jskjw157/Commerce_One/commit/fd97ee462ee16dd63c884035c5b8cbcb41ac2041)이다. 이번 변경은 이 경로의 신규 파일로만 구성되며, 기존 mock에 연결하거나 PR·배포를 실행하지 않는다.

## 실행

저장소 루트에서 실행한다. 테스트 자체는 외부 패키지 없이 Node의 TypeScript stripping과 `node:test`를 사용한다. Node 24.18 이상이 필요하며, 기존 mock의 Node 요구사항이나 빌드 설정을 바꾸지 않았다.

```powershell
npm --prefix .\poc\cafe24 test
```

엄격 타입 검사까지 실행하려면 독립 패키지의 개발 도구를 설치한다. 이번에는 기존 npm 캐시에서만 설치했으며 인터넷 설치로 대체하지 않았다. 캐시가 없는 환경에서는 첫 명령이 실패할 수 있지만 테스트만 실행하는 위 명령은 설치가 필요 없다.

```powershell
npm --prefix .\poc\cafe24 ci --offline --ignore-scripts --no-audit --no-fund
npm --prefix .\poc\cafe24 run check
```

`check`는 `tsc --project tsconfig.json`과 테스트를 순서대로 실행한다. 모든 테스트는 기존 `scripts/network-guard.mjs`를 **수정 없이 읽어 로드**하여 outbound 연결·fetch·DNS를 차단한다. 가드는 실수 방지 장치이지 OS 보안 격리가 아니다. 어댑터에도 호스트·토큰·OAuth·HTTP 클라이언트·실몰 transport가 없다.

## 산출물과 기존 mock 경계

- `adapter.ts`: `Cafe24OfflineAdapter`, 구체적인 메모리 전용 `FixtureTransport`, 최소 응답 검증.
- `fixtures.ts`: 직접 만든 합성 주문·상품·후기 응답과 기대 요청. 실몰 캡처가 아니다.
- `adapter.test.ts`: 공개 메서드의 결과와 외부로 보낼 논리적 요청 형태에 대한 계약 테스트.
- `package.json`, `package-lock.json`, `tsconfig.json`: 이 디렉터리만의 개발 도구와 검사 설정. 런타임 의존성 없음.

기존 `src/types.ts`의 동기 `Platform`과 `src/mock.ts`, `src/domain.ts`를 읽었다. 이 PoC는 그 인터페이스의 대체 구현이 아니며 기존 서버/UI에 등록하지 않았다. 요청 중복 방지, 링크·구매자 인증, 리뷰 유일성, 가져오기, 영속 저장은 기존 도메인의 책임이라 재구현하지 않았다. `PRD.md`, `REVIEW_PILOT.md`, 기존 소스·테스트·문서·루트 package/config 파일은 모두 그대로다.

## 공식 문서로 직접 확인한 계약

API 문서의 **2026-09-01 (Latest)** 버전을 브라우저에서 렌더링해 필요한 요청/응답 필드와 Properties·Example을 읽었고, OAuth 안내 본문도 별도로 조회했다. HTTP 200만으로 필드를 추정한 것이 아니다. API 경로 앞에는 `/api/v2/admin`이 붙는다. 실제 API 호출은 하지 않았다.

| 공식 근거 | 직접 확인한 내용 | 문서의 scope 표기 그대로 |
| --- | --- | --- |
| [D1 주문 목록](https://apidocs.cafe24.com/en/docs/admin/get-orders) | `GET /orders`; query `shop_no`, `order_id`(string 배열); 응답 `orders[]`의 `shop_no`, `order_id`, `paid`, `canceled`, `member_id`. `paid`: T 결제/F 미결제/M 부분 결제. `canceled`: T 취소/F 미취소/M 부분 취소 | `READ_ORDER` |
| [D2 주문상품](https://apidocs.cafe24.com/en/docs/admin/get-orders-by-order-id-items) | `GET /orders/{order_id}/items`; query `shop_no`; `items[]`의 `order_item_code`(string), `product_no`(integer), `quantity`, `order_status`, `status_code`, `product_bundle`, `claim_quantity`, `claim_code`, 취소·반품·교환·환불 날짜 필드 | `READ_ORDER` |
| [D3 게시물 등록](https://apidocs.cafe24.com/en/docs/admin/post-boards-by-board-no-articles) | `POST /boards/{board_no}/articles`; body `{shop_no, requests:[...]}`. 작성 요청의 `writer`, `title`(최대 256), `content`, `client_ip` 필수. `product_no`, `order_id`(최대 32), `rating`(1~5)은 별도 필드. 응답은 `articles[]`에 게시물·상품·주문 식별자와 내용을 포함. 상품 게시판에서는 평점 등 정보 등록 가능 | `write_community` |
| [D4 게시물 조회](https://apidocs.cafe24.com/en/docs/admin/get-boards-by-board-no-articles) | `GET /boards/{board_no}/articles`; query `product_no`, `is_display`, `shop_no`, `limit`(1~100), `offset`(0~8000). 응답의 `article_no`, `board_no`, `product_no`, `rating`, `display`, `secret`, `deleted` 등 확인. **한국어/일본어 상점에서만 사용 가능**이라고 안내 | `read_community` |
| [D5 게시판 설정 조회](https://apidocs.cafe24.com/en/docs/admin/get-boards) | `board_type=5`는 상품 게시판 유형이며 **게시판 번호 5라는 뜻이 아님**. `use_board`, `use_display`, `admin_confirm`, 작성 권한, `write_permission_extra.is_member_buy/is_guest_buy`, `member_write_after/guest_write_after`, `product_info_option` 등 별도 설정 존재. 한국어/일본어 상점 제한 안내 | `READ_COMMUNITY` |
| [D6 ScriptTag](https://apidocs.cafe24.com/en/docs/admin/post-scripttags) | `POST /scripttags`; body `{shop_no, request:{src, display_location,...}}`. `display_location` 필수이며 URL 경로가 아닌 화면의 역할. 예제 `PRODUCT_DETAIL`, `PRODUCT_LIST`; `skin_no`, `exclude_path`, `integrity` 지원 | `write_application` |
| [D7 OAuth 안내](https://apidocs.cafe24.com/en/docs/guide/oauth2-authentication) | scope별 동의와 Bearer 토큰 사용, 실제 승인 scope 확인 필요. 예제로 `mall.read_order`를 직접 명시. OAuth 구현·토큰 요청은 이번 범위가 아님 | 동의 범위는 토큰의 `scopes`와 대조해야 함 |
| [D8 배송정보 조회](https://apidocs.cafe24.com/en/docs/admin/get-orders-by-order-id-shipments) | `GET /orders/{order_id}/shipments`; `shipping_code`, `order_id`, `tracking_no`, `shipping_company_code`, `items[].order_item_code/status` 예제 확인. 부분 배송에는 배송번호가 여러 개 있을 수 있다고 명시. 운송장 존재를 배송 완료로 사용하지 않으며 이번 어댑터는 D2의 상품행 상태로 판단 | `READ_ORDER` |

scope 열은 문서의 대소문자를 그대로 옮긴 것이다. `READ_ORDER`와 OAuth 예제 `mall.read_order`를 구분한다. 다른 권한들의 실제 동의 문자열 매핑, 앱에 신청 가능한 범위, 심사 통과 및 특정 상점의 부여 권한은 **확인하지 않았다**. 권한을 새로 요청하거나 자격증명에 접근하지 않았다.

### 배송 상태 및 상품 연결의 의미

- D1의 상태 설명: `N00` 미결제, `N10` 주문 진행, `N20` 배송 준비, `N21` 배송 대기, `N22` 배송 보류, `N30` 배송 중, `N40` 배송 완료, `N50` 구매 확정. 취소 C 계열, 반품 R 계열, 교환 E 계열도 별도로 정의된다. 예: `C00` 취소 요청, `R00` 반품 요청, `E00` 교환 요청, `N01` 교환 수락 후 교환상품.
- D2의 `status_code=N1`은 정상, `N2`는 교환상품이며 `order_status`와 다른 필드다. `delivered_date` 같은 날짜가 있다는 이유로 현재 배송 완료를 단정하지 않는다.
- `order_item_code`와 `product_no`는 서로 다른 식별자다. 같은 상품의 옵션/행이 여러 개여도 행을 합치지 않는다. 작성 대상은 **상품 번호와 주문상품 코드의 쌍**으로 검사한다. Cafe24 게시물 요청에는 이 PoC가 확인한 범위에서 `product_no`와 `order_id`를 보내며, 주문상품 코드 자체를 게시물의 공식 필드인 것처럼 추가하지 않는다.
- 게시물의 `order_id`/`product_no` 존재는 주문 소유자 인증이나 네이티브 구매 배지 보장의 근거가 아니다. 게시판의 구매 이력 관련 설정도 Admin 등록이 동일한 검증을 수행한다는 증거가 아니다. **후기 응답 확인, 상품 번호 일치, 표시 후보 선정, 실제 상세 페이지 노출을 분리**해야 한다.
- ScriptTag의 `PRODUCT_DETAIL`도 특정 스킨의 DOM 위치·모바일 템플릿·위젯 정상 동작·구매 동선 안전을 보장하지 않는다. 이번에는 ScriptTag 요청조차 구현/실행하지 않았다.

제공된 `developers.cafe24.com/docs-new/...` 네 링크는 조회 시 404였다. 공식 [기존 문서 진입점](https://developers.cafe24.com/docs/en/api/admin/)의 리다이렉트로 현재 `apidocs.cafe24.com` 경로를 찾았다. 초기 서버 HTML의 `openapi-skeleton` 때문에 미확인으로 남겼던 상세 계약은 이번 재개에서 브라우저로 렌더링해 확인했다.

## fixture에서만 확인한 동작과 가정

`const a = new Cafe24OfflineAdapter(new FixtureTransport(fixtureSet().exchanges), {shopNo:1, boardNo:7})`로 생성한다.

| 공개 메서드 | 합성 데이터에서 검증한 계약 | 보장하지 않는 것 |
| --- | --- | --- |
| `assessOrder('SYN-O-100')` | 주문 1건·shop 일치, 상품행 구분·수량 보존. 전체 결제·미취소, 모든 행 N40/N50, 정상 상태·명시적 무클레임일 때만 `eligible:true`. `buyerAuthenticated:false` 유지 | 구매자 소유권, 실몰 주문 상태의 완전성/최신성 |
| `saveReview(reviewInput)` | 대상의 주문상품 코드+상품 번호 일치, 정해진 게시물 batch envelope, HTTP 상태와 반환 주문/상품/게시물/내용 대조. `acceptance:'fixture-response-only'` | 실제 저장·영속성·중복 방지·구매 인증·배지·노출 |
| `listProductReviews(101)` | 첫 페이지에서 같은 상품의 display=T/secret=F/deleted=F/평점 1~5만 선별. 주문·회원·메일·IP 필드를 결과에서 제외 | 실제 상세 노출, 전체 후기 수, 전체 페이지 수집, 텍스트 본문 내 개인정보 자동 제거 |

정책/안전 가정은 Cafe24의 필수 계약이나 확정 운영정책이 아니다:

- 상점 1·게시판 7은 합성 설정이며 실제 후기 게시판 조회 결과가 아니다. 배송 대상 3행은 상품 101(수량 2), 202(수량 1), 같은 상품 101의 다른 행(수량 1)로 비대칭 구성했다.
- `SYN-` 주문 ID만 허용한다. 일반적인 실제 주문 ID는 입력 단계에서 거절하며 문자열 배열 query를 직렬화하는 실 HTTP serializer도 없다.
- 결제/취소 `M`, 부분 배송, 미지 상태, 세트상품, 클레임 수량·코드·비정상 `status_code`·관련 날짜 중 하나라도 있으면 전체 주문 보류다. 이미 해결된 과거 클레임도 보수적으로 보류할 수 있다.
- 문서가 모든 필드를 필수로 표시한 것은 아니지만, fixture projection에서는 안전 관련 플래그와 날짜를 명시하도록 요구한다. 모르는 누락을 정상값으로 기본 처리하지 않는다. 이는 실제 응답 호환성 인증이 아니다.
- 주문상품 문서의 `Request Limit=100items`와 별도 pagination 부재를 고려해 100행 이상은 완전성 미확인으로 보류한다. 이 해석은 보수적 PoC 가정이다. 후기 조회는 첫 100행만 다루며 꽉 찬 페이지에는 `mayHaveMore:true`를 돌려준다.
- 본문 최대 1000자·공백 제거·무수정 저장 내용 대조는 로컬 정책이다. 작성자와 `client_ip=127.0.0.1`은 합성 고정값이다. 등록 요청 `rating`은 1~5지만 문서의 일반 게시물 응답 예제에는 0도 있어, 조회 시 0점 행은 후기 후보에서 제외한다.
- `FixtureTransport`는 정확히 일치하는 정적 요청에만 canned 응답을 돌려준다. 등록 fixture와 조회 fixture는 **독립적이며 저장 후 다시 읽은 영속성 증거가 아니다**. 반복 호출이 같은 ID를 반환해도 멱등성을 증명하지 않는다.
- 오류 상태(401/403/422/429/500 등)는 본문을 유출하지 않고 반환하며 자동 재시도하지 않는다. 미래의 실통신에서는 오류나 응답 불일치가 저장 미발생을 뜻하지 않으므로 무작정 POST 재시도를 하면 안 된다.
- 반환 `title`/`content`는 신뢰할 수 없는 원문 데이터다. HTML sanitization/렌더러는 없으며, 후속 UI는 안전한 텍스트 출력 또는 검증된 sanitization이 필요하다. 보이는 고객 식별 metadata만 제거하며 본문 개인정보를 자동 익명화하지 않는다.

## 실행 결과와 재개 시 남은 일

이번 runner에서 다음을 실제 실행했다:

| 검사 | 결과 |
| --- | --- |
| npm 캐시 전용 install 및 lockfile 기반 `ci --offline --ignore-scripts --no-audit --no-fund` | 성공, 개발 도구 3개 패키지, 외부 설치 없음 |
| `npm --prefix .\poc\cafe24 run check` | 종료 0, strict 타입 검사 통과, **15/15 테스트 통과**, 실패/skip 0 |
| 네트워크 가드 아래 합성 assessment → 등록 응답 검사 → 독립 조회 fixture를 함께 실행 | 3개 주문상품 보존, 게시물 9001/상품 101 일치, 공개 후보 8행 중 1행 반환. 인증/배지/상세노출은 미검증 표기 유지 |
| 기준 대비 `git diff --quiet <기준 SHA> --` | 종료 0, 기존 tracked 파일 전부 무수정. 신규 파일은 `poc/cafe24/**`에만 존재 |

로컬 증거: 저장소의 `.amp/in/artifacts/cafe24-check.log`, `cafe24-demo.json`, `cafe24-docs/*.txt`. 이 경로는 로컬 Git exclude로 제외되며 인계 계약의 공식 링크/필드 요약은 이 문서에 보존한다. 기존 mock의 전체 lint/build/E2E는 이번에 재실행하지 않았고 Windows에서 기존 UI를 재검증했다고 주장하지 않는다. UI 코드 변경도 없다.

실몰·실주문·실고객 데이터, 자격증명, 새 권한, 고객 발송, 운영 배포, 스킨 변경, 요금제/결제 변경은 전부 미실행이다. 실몰 검증이 승인되기 전에는 live transport를 추가하거나 환경변수를 연결하지 말 것. 이후에는 별도 승인과 함께 앱 심사/부여 scope·상점 언어/게시판 유형·구매 이력/검수 설정·실제 응답의 nullable/claim/배송 완전성·안전한 구매자 인증·중복/불명 저장 처리·스킨/모바일 실제 표시를 각각 검증해야 한다. 이 문서는 그 승인이 아니다.
