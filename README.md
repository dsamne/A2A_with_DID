# DID 기반 A2A(Agent-to-Agent) 인증 시스템

블록체인 기반 탈중앙화 신원(DID) 인증을 사용한 양방향 Agent 인증 시스템입니다.

## 주요 기능

- ✅ **양방향 DID 인증**: Client와 Server가 서로를 검증
- ✅ **블록체인 기반**: Ethereum 블록체인에 DID 등록
- ✅ **VC/VP 표준**: W3C Verifiable Credentials 표준 준수
- ✅ **정책 기반 권한 관리**: PolicyValidator를 통한 세밀한 권한 제어
- ✅ **AI Agent 통합**: 인증 후 AI 작업 수행
- ✅ **웹 UI**: 실시간 인증 과정 시각화

## 시스템 구조

```
├── 1_chain.js          # 로컬 블록체인 (Ganache) 실행
├── 2_server.js         # Server Agent (VP 검증 + AI 작업)
├── 3_client.js         # Client Agent (CLI 버전)
├── issuer.js           # VC 발급 기관
├── policy.js           # 정책 검증 엔진
├── test_all.js         # 통합 테스트
└── public/             # 웹 UI
    ├── index.html      # 메인 페이지
    └── client-auth.js  # 브라우저 DID 인증 클라이언트
```

## 설치 방법

### 1. 필수 요구사항
- Node.js 14+ 
- npm

### 2. 의존성 설치

```bash
npm install
```

## 실행 방법

### PowerShell에서 실행 (Windows)

```powershell
# 1. 기존 프로세스 종료
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. 대기
Start-Sleep -Seconds 2

# 3. 블록체인 시작 (새 창)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; node 1_chain.js"

# 4. 블록체인 초기화 대기
Start-Sleep -Seconds 4

# 5. 서버 시작 (새 창)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PWD'; node 2_server.js"

# 6. 서버 초기화 대기
Start-Sleep -Seconds 3

# 7. 브라우저 열기
start http://localhost:3000
```

### Bash에서 실행 (Linux/Mac)

```bash
# 블록체인 시작
node 1_chain.js &

# 서버 시작
sleep 4
node 2_server.js &

# 브라우저 열기
sleep 3
open http://localhost:3000  # Mac
xdg-open http://localhost:3000  # Linux
```

## 사용 방법

1. 브라우저에서 http://localhost:3000 접속
2. "DID 인증 시작" 버튼 클릭
3. 실시간으로 7단계 Client 인증 + 9단계 Server 검증 과정 확인
4. AI Agent Task 결과 확인

## 인증 흐름

### Client Side (7단계)
1. Client DID 생성
2. Server Agent Card 요청
3. Server VP 검증 (양방향 인증)
4. Issuer로부터 VC 발급
5. VP 생성 및 서명
6. Server에 VP 전송
7. Authorization Token 수신

### Server Side (9단계)
1. Agent Card 정보 제공
2. VP 수신
3. VP 서명 검증
4. DID 문서 조회
5. Revocation Status 확인
6. Policy Compliance 검증
7. 권한 부여 결정
8. Authorization Token 발급
9. AI Task 처리

## 주요 파일 설명

### issuer.js
- 독립적인 VC 발급 기관
- TaskLogVC, ServiceEndpointVC 발급
- OAuth의 Authorization Server에 해당

### policy.js
- 정책 기반 권한 검증 엔진
- Revocation 체크
- Policy Compliance 검증
- Authorization Token 생성

### 2_server.js
- Server Agent의 메인 로직
- 7단계 VP 검증 프로세스
- AI Task 처리 (`/ai/task` 엔드포인트)

## API 엔드포인트

### Server APIs
- `GET /agent-card` - Server의 Agent Card 정보
- `POST /a2a/authenticate` - VP 기반 인증
- `POST /ai/task` - AI Agent 작업 요청
- `POST /api/verify-server-vp` - Server VP 검증
- `POST /api/issue-vc` - VC 발급 요청

## 기술 스택

- **블록체인**: Ganache (로컬 Ethereum)
- **DID**: ethr-did, did-jwt-vc
- **서버**: Express.js
- **프론트엔드**: Vanilla JS, ethers.js
- **표준**: W3C DID, W3C Verifiable Credentials

## OAuth 2.0과 비교

| 항목 | OAuth 2.0 | DID 방식 |
|------|-----------|----------|
| 신원 관리 | 중앙화 (IdP) | 탈중앙화 (DID) |
| 토큰 발급 | Authorization Server | Issuer + VP |
| 검증 방법 | Token Introspection | VP 서명 검증 |
| 권한 관리 | Scope | VC Claims + Policy |
| 신뢰 모델 | 서버 신뢰 | 암호학적 검증 |

## 라이선스

MIT

## 참고 자료

- [W3C DID Specification](https://www.w3.org/TR/did-core/)
- [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/)
- [ethr-did](https://github.com/decentralized-identity/ethr-did)
