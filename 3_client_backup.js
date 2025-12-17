// 3_client.js
const { ethers } = require("ethers");
const { EthrDID } = require("ethr-did");
const { createVerifiableCredentialJwt, createVerifiablePresentationJwt, verifyPresentation } = require("did-jwt-vc");
const { ES256KSigner } = require("did-jwt");
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const fs = require('fs');
const fetch = require('node-fetch');
const VCIssuer = require('./issuer');

// a2a-js의 Client 클래스 흉내 (인증 핸들러 주입 가능 구조)
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

// === [핵심] DID 인증 핸들러 ===
class DIDAuthHandler {
  constructor() {
    // 1. 내 지갑 생성 (랜덤 키)
    this.wallet = ethers.Wallet.createRandom();
    
    // 2. DID 문자열 생성
    this.didString = `did:ethr:development:${this.wallet.address}`;
    
    // 3. ES256K Signer 생성 (recovery bit 없는 compact signature)
    // privateKey를 Buffer로 변환 (hex string -> Uint8Array)
    const privateKeyHex = this.wallet.privateKey.startsWith('0x') 
      ? this.wallet.privateKey.slice(2) 
      : this.wallet.privateKey;
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    this.signer = ES256KSigner(privateKeyBytes, false); // recoverable=false
    
    console.log(`🔑 [Client] 내 DID 생성 완료: ${this.didString}`);
  }

  // Task 정보를 받아 VC로 만들고, VP로 서명하는 함수
  // Authentication phase(DID) 2: Issuer로부터 VC 받아서 VP 생성
  async generateVP(taskContext, issuer) {
    console.log(`🎫 [Client] Issuer에게 VC 요청 중...`);
    
    // 1. Issuer로부터 TaskLog VC 발급받기
    const vcJwt = await issuer.issueTaskLogVC(this.didString, taskContext);

    // 2. VP 생성 (서버 제출용 서명)
    const vpJwt = await createVerifiablePresentationJwt({
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [vcJwt]
      },
      audience: "did:ethr:development:SERVER" 
    }, { did: this.didString, signer: this.signer });

    return vpJwt;
  }
}

// === 실행 로직 ===
async function run() {
  const authHandler = new DIDAuthHandler();
  const SERVER_URL = "http://localhost:3000";

  // **[핵심] fetch 가로채기 (Interceptor Pattern)**
  const customFetch = async (url, options = {}) => {
    // 1. Agent Card 요청은 그냥 보냄
    if (url.includes('/agent-card')) {
      return fetch(url, options);
    }

    // 2. 그 외 메시지 전송은 DID 인증이 필요함
    console.log("🛡️ [Client] 요청 가로채기... VP 생성 및 주입 중");
    
    // 현재 수행할 작업 기록 (Task Log)
    const taskContext = { action: "OrderPizza", timestamp: Date.now() };
    
    // VP 생성
    const vp = await authHandler.generateVP(taskContext);

    // 헤더에 VP 추가 (기존 OAuth Bearer 토큰 대체)
    options.headers = {
      ...options.headers,
      'x-a2a-did-vp': vp
    };

    return fetch(url, options);
  };

  // 클라이언트 초기화
  const client = new A2AClient({
    agentUrl: SERVER_URL,
    fetch: customFetch // 오버라이딩된 fetch 주입
  });

  console.log("🤖 [Client] 서버 연결 시도...");

  // 1. Agent Card 확인
  const card = await client.getAgentCard();
  console.log(`📨 [Client] Agent Card 수신: ${card.name} (${card.did})`);

  // 2. 메시지 전송 (자동으로 VP가 포함됨)
  console.log("🚀 [Client] 메시지 전송 시도...");
  const response = await client.sendMessage({ text: "Hello A2A!" });

  console.log("📩 [Client] 서버 응답:", response);
}

run();
