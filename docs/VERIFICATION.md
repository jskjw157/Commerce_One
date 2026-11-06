# 리뷰 파일럿 로컬 검증 보고서

실행일: **2026-11-06 UTC**. 검증 대상은 합성 자료만 사용하는 localhost mock 구현입니다. 카페24 테스트몰·실주문·실제 상품 후기는 대상이 아닙니다.

## 환경과 실행 결과

| 항목 | 환경 / 결과 |
|---|---|
| 저장소 기준 | `b33f6c5`에서 새 클론, `codex/review-pilot-mock` 전용 브랜치 |
| 실행 | macOS, Node.js 22.23.0, npm 10.9.8 |
| 브라우저 | 설치된 Google Chrome 156.0.8078.81, Playwright 1.65.0 |
| 화면 | 데스크톱 1440×1000 / iPhone 13 390×664 에뮬레이션, 양쪽 모두 Chromium |
| 데이터 | 고정 합성 상품 3개, 합성 주문 6건, 가져오기 표본 4행. 테스트마다 격리 임시 저장소 |
| `npm run lint` | 통과, 오류 0 |
| `npm run typecheck` | 통과, strict TypeScript 서버·테스트·E2E |
| `npm run build` | 통과, TypeScript 컴파일 및 정적 파일·실행 가드 복사 |
| `npm test` | 통과, Node 테스트 20개 / 실패·건너뜀 0 |
| `npm run test:e2e` | 통과, 4개 흐름 × 데스크톱·모바일 = 8개 / 실패 0 |
| `npm run check` | 위 전체 순차 실행, 종료 코드 0 |

보존한 [성공 실행 로그](evidence/check.log)가 원본 증거입니다. Playwright는 상속된 `NO_COLOR`와 `FORCE_COLOR`가 함께 설정돼 있다는 경고를 출력했지만 검사 실패는 없었습니다. 샌드박스 기본 모드의 localhost listen은 EPERM이었으며, 로컬 수신을 허용한 실행에서 검증했습니다. 현재 대기 중인 승인이나 미해결 로컬 실행 차단은 없습니다.

## 요구사항별 증거

| 요구사항 / 공격·오류 흐름 | 실제 결과 | 자동 검증 |
|---|---|---|
| 배송 완료 주문 → 요청 기록·링크 | SYN-O-100 대상, 한 주문의 두 상품 슬롯 | domain / HTTP / E2E |
| 주문 이벤트 재처리·재클릭 | 같은 요청 ID·링크, 요청 1건 유지 | domain / E2E |
| 동시 요청 | 12개 병렬 요청 → 요청 1건 | HTTP |
| 주문·상품 작성 범위 | 다른 주문·대상 외 상품은 403, 저장 0 | domain / HTTP |
| 구매자·링크 보호 | 다른 합성 구매자 403, 없는 세션 401, 변조 토큰 거절 | domain / HTTP / E2E |
| 만료·재사용 | 7일 경계부터 410, 만료된 exact replay도 거절. 전 상품 완료 시 consumed | domain / 만료 화면 E2E |
| 상품별 중복 | 동일 내용은 원래 ID 반환. 변경은 409. 12개 동시 제출 → 리뷰 1건 | domain / HTTP |
| 부분 배송·취소·반품·미결제 | 전체 주문 보류, 링크 발급 안 됨. 생성 후 반품 상태도 쓰기 보류 | domain / HTTP / 보류 화면 E2E |
| 입력 검증 | 잘못된 별점·본문·추가 필드 거절, JSON 형식·16KB 한도·미지원 MIME 거절 | domain / HTTP |
| 상품 연결과 공개 표시 | 저장한 상품에만 표시. 다른 상품에는 미노출 | domain / E2E |
| 공개 정보 경계 | widget 응답 필드를 명시적으로 선택. 주문·구매자 ID·토큰·secret 제외 | domain / HTTP |
| XSS 합성 문자열 | `<img ... onerror=...>`를 일반 텍스트로 표시, window 오염 없음 | desktop / mobile E2E |
| 가져오기 | 정상 2행, 매핑 실패 1행·중복 불명확 1행 검토 큐. 원본·출처·권한 표식 보존 | domain / HTTP / E2E |
| 가져오기 검증 배지 | 모두 mockVerified=false. `가져온 합성 리뷰 · 구매 미검증`과 원본 ID 표시 | domain / E2E |
| 출처키 충돌·권한 미확인 | 출처+원본 ID가 같고 내용·상품이 다르면 검토 큐. 기존 리뷰 그대로 | domain |
| 가져오기 재실행 | 리뷰·검토 큐 추가 0, 덮어쓰기 없음 | domain / HTTP / E2E |
| 저장 실패 | 디스크 쓰기를 막으면 기존 메모리·파일 유지, 해제 후 재시도 성공 | domain |
| 화면 저장 오류 | 저장 API 500 합성 주입 시 입력 유지·오류 표시·재시도 성공 | desktop / mobile E2E |
| 정상 재시작 | 링크 검증·요청/리뷰/가져오기 키·검토 큐 유지 | domain |
| 프로세스 강제 중단 | SIGKILL 후 lock으로 안전 정지. 소유 프로세스 종료 확인 후 stale lock만 회수하고 재시작, 확정 저장된 요청·리뷰 각각 1건 유지 | process integration |
| 미완성 임시 파일 | 재시작 시 확정 state.json을 읽고 불완전 `.tmp`를 사용하지 않음 | process integration |
| 저장소 유일성 | 중복 요청 삽입 자체를 불변식에서 거절, 트랜잭션 전체 rollback. 두 번째 프로세스는 lock으로 거절 | domain |
| UTF-8 수신 청크 | 한글 글자 중간에서 자른 실제 chunked 요청도 원문 저장, 다른 분할로 재시도해도 같은 리뷰 | HTTP |
| Host·Origin·CSP | 위조 Host·외부 Origin 403. no-store, no-referrer, same-origin CSP | HTTP |
| 외부 네트워크 | fetch/net/TLS/HTTP(S)/HTTP2/DNS/UDP 모두 접속 전에 거절 | 별도 가드 프로세스 테스트 |
| 구매 시뮬레이션 비간섭 | 위젯 API 503 및 위젯 JS 로드 실패에도 장바구니·구매 버튼 동작 | desktop / mobile E2E |

저장소의 유일성은 PostgreSQL 제약이 아니라, 독점 lock 아래 변경 복사본의 모든 유일키를 검사하고 원자적 파일 교체로 커밋하는 방식입니다. 확정 저장 후 단순 프로세스 중단은 검증했지만 디스크 전원 차단·네트워크 파일시스템·멀티프로세스 운용은 검증하지 않았습니다.

## 독립 검토와 수정

읽기 전용 별도 검토자가 인증·주문/상품 scope·중복·파일 저장·mock 안전 경계·공개 projection을 검토했습니다. P2 1건: 요청 Buffer를 청크마다 문자열로 바꾸면 UTF-8 한글이 손상되고 동일 재시도가 충돌할 수 있었습니다. 실제 HTTP 회귀에서 `합성`이 `���성`으로 저장되는 것을 먼저 확인한 뒤, 원시 Buffer를 모아 한 번 해석하도록 수정했고 회귀와 전체 검사 모두 통과했습니다. 별도의 구체적인 파일럿 경계 결함은 보고되지 않았습니다.

초기 E2E에서 숫자형 루프백 주소 확인까지 네트워크 가드가 막는 문제와, URL fragment만 바뀔 때 이전 토큰이 남는 문제도 발견해 수정했습니다. 전자는 숫자 `127.0.0.1`의 수신 주소 확인만 예외로 두었고 모든 outbound socket은 계속 차단합니다. 후자는 hashchange에서 작성 화면을 다시 구성하여 정상·변조 링크 전환을 검증했습니다. 저장 오류 보존 테스트의 textarea 검증은 텍스트 노드 대신 실제 value를 검사하도록 수정했습니다. 최종 실패 0건입니다.

## 보존한 화면

- [데스크톱 작성·저장](evidence/screenshots/desktop-write.png)
- [모바일 작성·저장](evidence/screenshots/mobile-write.png)
- [데스크톱 상품 연결](evidence/screenshots/desktop-product.png)
- [모바일 상품 연결](evidence/screenshots/mobile-product.png)
- [데스크톱 관리자·가져오기 검토 큐](evidence/screenshots/desktop-admin.png)
- [모바일 관리자·가져오기 검토 큐](evidence/screenshots/mobile-admin.png)

화면은 합성 데이터와 XSS 회귀용 문장을 포함합니다. 유효 작성 토큰·세션 값은 스크린샷이나 성공 로그에 포함하지 않았습니다.

## 미실행과 다음 경계

| 항목 | 상태 / 남은 증거 |
|---|---|
| 카페24 주문·배송 조회·웹훅 | **미실행**. 공식 버전·권한·테스트몰 응답·상태 매핑 확인 필요 |
| OAuth·실제 구매자 소유권 | **미구현/미실행**. 선택 가능한 데모 세션은 실제 인증이 아님 |
| 카페24 후기 쓰기·상품 후기 연결·구매 검증 배지 | **미실행**. 로컬 앱 데이터의 상품 연결만 통과 |
| ScriptTag·운영 스킨·실제 장바구니/결제 비간섭 | **미실행**. 이 앱의 버튼은 문구만 표시하는 시뮬레이션 |
| 실제 모바일 Safari·실기기·다른 스킨 | **미실행**. Chrome 에뮬레이션만 통과 |
| 실제 원본 반출권·법적 권한 확인 | **미실행**. 권한 확인 표식이 있는 고정 합성 원본만 사용 |
| 실제 발송·실제 고객 리뷰·실주문 조작·실몰 자격증명 | **미실행**, 이번 구현 경로에 없음 |
| 운영 배포·원격 푸시·PR | **미실행**, 로컬 브랜치 커밋만 보존 |
| 작성률·관리 시간 절감·매출 개선 | **미측정**. 테스트 링크 수를 전달 수나 실제 성과로 계산하지 않음 |

mock 정책은 [README](../README.md)에 명시했습니다. 운영 확정 정책으로 채택하지 않았습니다. 실제 Cafe24 어댑터·공식 API 조사 문서는 이 작업에서 만들지 않았고 Puck 세션에 메시지를 보내지 않았습니다.

테스트 도구와 경계 참고: [Playwright 네트워크 제어](https://playwright.dev/docs/network), [Node.js 권한 모델의 한계](https://nodejs.org/docs/latest-v22.x/api/permissions.html). 이 앱의 자체 가드는 Node 권한 플래그나 OS 방화벽을 구현한 것이 아닙니다.
