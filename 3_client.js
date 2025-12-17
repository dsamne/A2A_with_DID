// 3_client.js - Client Agent (DID 기반 인증 클라이언트)
//
// 역할:
// 1. Server의 VP를 받아 검증 (양방향 인증)
// 2. Issuer로부터 VC 발급 받기
// 3. VC를 담은 VP 생성 후 Server에 전송
// 4. 인증 성공 시 Authorization Token 수신
//
// OAuth 2.0과 비교:
// - OAuth: Resource Owner가 바로 Client에 권한 부여
// - DID: Client가 Issuer로부터 VC 발급받아 VP로 제출

const { ethers } = require("ethers");
const { EthrDID } = require("ethr-did");
const { createVerifiableCredentialJwt, createVerifiablePresentationJwt, verifyPresentation } = require("did-jwt-vc");
const { ES256KSigner } = require("did-jwt");
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const fs = require('fs');
const fetch = require('node-fetch');
const VCIssuer = require('./issuer');

// ===== A2A Client 클래스 =====
// a2a-js 라이브러리의 Client 클래스를 단순화하여 구현
// 인증 핸들러(fetch)를 주입할 수 있는 구조
class A2AClient {
  constructor(options) {
    this.agentUrl = options.agentUrl;
    this.fetch = options.fetch || fetch; // 커스텀 fetch 사용
  }

  async getAgentCard() {
    const res = await this.fetch(`${this.agentUrl}/agent-card`);
    return res.json();
  }

  async sendMessage(msg) {
    const res = await this.fetch(`${this.agentUrl}/a2a/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
    return res.json();
  }
}

// 설정 로드
const RPC_URL = "http://127.0.0.1:8545";
const REGISTRY_ADDRESS = fs.readFileSync("registry_address.txt", "utf8").trim();

// DID Resolver 설정
const didResolver = new Resolver(getResolver({
  name: 'development',
  rpcUrl: RPC_URL,
  registry: REGISTRY_ADDRESS,
}));

// ===== [핵심] DID 인증 핸들러 =====
// OAuth의 Client Credentials에 해당하는 부분
// 하지만 DID는 중앙 서버 없이 블록체인으로 신원 증명
class DIDAuthHandler {
  constructor() {
    // ===== 1단계: 내 지갑 생성 (Registration Phase) =====
    // 랜덤 개인키로 지갑 생성 (실제로는 안전하게 저장해야 함)
    this.wallet = ethers.Wallet.createRandom();
    
    // ===== 2단계: DID 문자열 생성 =====
    // 이더리움 주소를 DID 형식으로 변환
    // did:ethr:development:0x...
    this.didString = `did:ethr:development:${this.wallet.address}`;
    
    // ===== 3단계: ES256K Signer 생성 =====
    // VP에 서명하기 위한 서명 도구
    // recovery bit=false: compact signature (표준 JWT 형식)
    const privateKeyHex = this.wallet.privateKey.startsWith('0x') 
      ? this.wallet.privateKey.slice(2) 
      : this.wallet.privateKey;
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    this.signer = ES256KSigner(privateKeyBytes, false);
    
    console.log(`[Client] 내 DID 생성 완료: ${this.didString}`);
  }

  /**
   * Authentication Phase(DID) 2: Issuer로부터 VC 받아서 VP 생성
   * 
   * OAuth와 비교:
   * - OAuth: Authorization Code로 Access Token 교환
   * - DID: Issuer로부터 VC 발급받아 VP로 포장
   */
  async generateVP(taskContext, issuer) {
    console.log(`[Client] Issuer에게 VC 요청 중...`);
    
    // ===== Step 1: Issuer로부터 TaskLog VC 발급받기 =====
    // OAuth의 Authorization Server가 Access Token 발급하는 것과 유사
    // 하지만 VC는 블록체인에서 검증 가능한 증명서
    const vcJwt = await issuer.issueTaskLogVC(this.didString, taskContext);

    // ===== Step 2: VC를 담은 VP 생성 =====
    // VP = Verifiable Presentation
    // 여러 VC를 하나로 묶어 제출하는 패키지
    // 내 개인키로 서명하여 위조 방지
    const vpPayload = {
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [vcJwt]  // VC들을 배열로 담음
      }
    };

    // JWT 형식의 VP 생성 (내 DID와 서명으로)
    const vpJwt = await createVerifiablePresentationJwt(
      vpPayload,
      { did: this.didString, signer: this.signer }
    );

    console.log(`[Client] VP 생성 완료`);
    return vpJwt;
  }
}

// === 실행 ===
async function run() {
  const SERVER_URL = "http://localhost:3000";

  console.log("\n[Client] A2A DID 양방향 인증 시작\n");

  // === DID 인증 핸들러 생성 ===
  const authHandler = new DIDAuthHandler();
  console.log(`[Client] 내 DID: ${authHandler.didString}`);
  
  // === Issuer 초기화 ===
  const issuer = new VCIssuer();

  // === Fetch Interceptor 패턴 ===
  const customFetch = async (url, options = {}) => {
    if (url.includes('/agent-card')) {
      return fetch(url, options);
    }

    console.log("[Client] 요청 가로채기... VP 생성 및 주입 중");
    
    // Authentication phase(DID) 2: Task Log 생성
    const taskContext = { action: "OrderPizza", timestamp: Date.now() };
    
    // VP 생성 (Issuer로부터 VC 발급)
    const vp = await authHandler.generateVP(taskContext, issuer);

    // 헤더에 VP 추가
    options.headers = {
      ...options.headers,
      'x-a2a-did-vp': vp
    };

    return fetch(url, options);
  };

  // 클라이언트 초기화
  const client = new A2AClient({
    agentUrl: SERVER_URL,
    fetch: customFetch
  });

  console.log("🤖 [Client] 서버 연결 시도...\n");

  // Authentication phase(DID) 1: Agent Card 확인
  console.log("📬 [Client] Step 1: Agent Card 요청");
  const card = await client.getAgentCard();
  console.log(`📨 [Client] Agent Card 수신: ${card.name}`);
  console.log(`🆔 [Client] Server DID: ${card.did}`);
  
  // Authentication phase(DID) 1: Server의 VP 검증
  if (card.serverVP) {
    console.log(`\n🔍 [Client] Step 2: Server VP 검증 중...`);
    try {
      const verifiedServerVP = await verifyPresentation(card.serverVP, didResolver);
      console.log(`✅ [Client] Server 인증 성공!`);
      const serverVCType = verifiedServerVP.verifiablePresentation?.verifiableCredential?.[0]?.type 
        || verifiedServerVP.verifiableCredential?.[0]?.type
        || 'ServiceEndpoint';
      console.log(`📋 [Client] Server VC 타입:`, serverVCType);
    } catch (error) {
      console.error(`❌ [Client] Server VP 검증 실패:`, error.message);
      // 계속 진행 (Server VP는 선택사항)
    }
  }

  // Authentication phase(DID) 2: 메시지 전송
  console.log(`\n🚀 [Client] Step 3: 메시지 전송 (VP 포함)`);
  const response = await client.sendMessage({ text: "Hello A2A with Full DID Auth!" });

  console.log(`\n📩 [Client] Step 4: 서버 응답:`);
  console.log(`  - 상태: ${response.status}`);
  console.log(`  - 메시지: ${response.message}`);
  if (response.authorization) {
    console.log(`  - Authorization Token: ${response.authorization.tokenType}`);
    console.log(`  - 부여된 권한:`, response.permissions);
    console.log(`  - 만료 시간: ${response.authorization.expiresIn}초`);
  }
  
  console.log(`\n✅ [Client] 양방향 DID 인증 완료!\n`);
}

run();
