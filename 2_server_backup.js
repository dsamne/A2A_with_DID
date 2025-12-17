// 2_server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { Resolver } = require('did-resolver');
const { getResolver } = require('ethr-did-resolver');
const { verifyPresentation } = require('did-jwt-vc');
const { createVerifiableCredentialJwt, createVerifiablePresentationJwt } = require('did-jwt-vc');
const { ES256KSigner } = require('did-jwt');
const VCIssuer = require('./issuer');
const PolicyValidator = require('./policy');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3000;
const RPC_URL = "http://127.0.0.1:8545";

// 1_chain.js가 만든 주소 파일을 읽어옵니다.
const REGISTRY_ADDRESS = fs.readFileSync("registry_address.txt", "utf8").trim();

// DID Resolver 설정 (로컬 블록체인과 연결)
const didResolver = new Resolver(getResolver({
  name: 'development',
  rpcUrl: RPC_URL,
  registry: REGISTRY_ADDRESS,
}));

// Server Agent의 자체 DID 생성
const serverWallet = ethers.Wallet.createRandom();
const serverDID = `did:ethr:development:${serverWallet.address}`;
const serverPrivateKeyHex = serverWallet.privateKey.startsWith('0x') 
  ? serverWallet.privateKey.slice(2) 
  : serverWallet.privateKey;
const serverPrivateKeyBytes = Buffer.from(serverPrivateKeyHex, 'hex');
const serverSigner = ES256KSigner(serverPrivateKeyBytes, false);

console.log(`🏢 [Server] Server Agent DID: ${serverDID}`);

// Issuer 및 PolicyValidator 초기화
const issuer = new VCIssuer();
const policyValidator = new PolicyValidator(didResolver);

// Server의 ServiceEndpoint VC 발급 (초기화 시)
let serverVC = null;
let serverVP = null;

(async () => {
  serverVC = await issuer.issueServiceEndpointVC(serverDID, {
    url: `http://localhost:${PORT}`,
    protocols: ['A2A', 'DID-Auth'],
    version: '1.0'
  });
  
  // Server의 VP 생성
  serverVP = await createVerifiablePresentationJwt(
    {
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [serverVC]
      }
    },
    { did: serverDID, signer: serverSigner }
  );
  
  console.log(`✅ [Server] Server VP 생성 완료`);
})();

// API: Registry 주소 제공
app.get('/api/registry-address', (req, res) => {
  res.send(REGISTRY_ADDRESS);
});

// API: VC 생성 (브라우저에서 crypto 작업이 복잡하므로 서버에서 처리)
app.post('/api/create-vc', async (req, res) => {
  try {
    const { vcPayload, privateKey } = req.body;
    
    // privateKey를 Buffer로 변환
    const privateKeyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const signer = ES256KSigner(privateKeyBytes, false);
    
    const vcJwt = await createVerifiableCredentialJwt(
      vcPayload,
      { did: vcPayload.sub, signer }
    );
    
    res.json({ vcJwt });
  } catch (error) {
    console.error('VC 생성 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: VP 생성
app.post('/api/create-vp', async (req, res) => {
  try {
    const { vpPayload, privateKey, did } = req.body;
    
    const privateKeyHex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    const signer = ES256KSigner(privateKeyBytes, false);
    
    const vpJwt = await createVerifiablePresentationJwt(
      vpPayload,
      { did, signer }
    );
    
    res.json({ vpJwt });
  } catch (error) {
    console.error('VP 생성 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1. Agent Card 제공 (Client가 제일 먼저 확인하는 곳)
app.get('/agent-card', (req, res) => {
  console.log(`📬 [Server] Agent Card 요청 수신`);
  res.json({
    name: "Burger Server Agent",
    description: "DID 기반 양방향 인증 에이전트",
    did: serverDID,
    // Authentication phase(DID) 1: Server의 VP 제공
    serverVP: serverVP,
    securitySchemes: {
      did_auth: {
        type: "did-vc",
        description: "TaskLog VC가 포함된 VP를 제출하세요.",
        issuerDID: issuer.did
      }
    }
  });
});

// 2. 메시지 수신 (DID 인증 로직 포함)
app.post('/a2a/message', async (req, res) => {
  // 헤더에서 VP 토큰 추출
  const vpJwt = req.headers['x-a2a-did-vp'];

  if (!vpJwt) {
    console.log("❌ [Server] 요청 거부: VP가 없습니다.");
    return res.status(401).json({ error: "Authentication Required (VP)" });
  }

  try {
    console.log("🔎 [Server] Client의 VP 검증 시작...");
    
    // 블록체인에서 DID 문서를 조회하고 서명을 검증
    const verified = await verifyPresentation(vpJwt, didResolver);
    
    // 검증 성공 시, 내부 VC 데이터 확인
    const vc = verified.verifiablePresentation.verifiableCredential[0];
    const clientDid = vc.credentialSubject.id;
    const taskInfo = vc.credentialSubject.task;

    console.log(`✅ [Server] 인증 성공! Client DID: ${clientDid}`);
    console.log(`📄 [Server] 수행 Task 내용: ${JSON.stringify(taskInfo)}`);

    // 응답 전송
    res.json({
      status: "success",
      message: `반갑습니다 ${clientDid}님, 블록체인에서 당신의 Task VC를 확인했습니다!`
    });

  } catch (e) {
    console.error("❌ [Server] 검증 실패:", e.message);
    console.error("❌ [Server] 상세 에러:", e);
    res.status(403).json({ error: "유효하지 않은 DID 서명입니다." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 [Server] Agent 서버가 ${PORT}번 포트에서 실행 중입니다.`);
  console.log(`🌐 [Server] 웹 UI: http://localhost:${PORT}`);
});
