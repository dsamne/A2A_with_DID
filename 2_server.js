// 2_server.js - Server Agent (양방향 DID 인증 + 정책 검증)
// 
// 역할:
// 1. Server 자체의 DID로 신원 증명 (Server VP 제공)
// 2. Client의 VP를 받아 블록체인 기반 검증
// 3. VC의 Claims를 정책과 비교하여 권한 부여
// 4. AI Agent로서 Task 수행
//
// OAuth 2.0과 비교:
// - OAuth: Authorization Server가 토큰 발급
// - DID: Issuer가 VC 발급, Server가 VP 검증 후 권한 부여

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

const REGISTRY_ADDRESS = fs.readFileSync("registry_address.txt", "utf8").trim();

const didResolver = new Resolver(getResolver({
  name: 'development',
  rpcUrl: RPC_URL,
  registry: REGISTRY_ADDRESS,
}));

const serverWallet = ethers.Wallet.createRandom();
const serverDID = `did:ethr:development:${serverWallet.address}`;
const serverPrivateKeyHex = serverWallet.privateKey.startsWith('0x') 
  ? serverWallet.privateKey.slice(2) 
  : serverWallet.privateKey;
const serverPrivateKeyBytes = Buffer.from(serverPrivateKeyHex, 'hex');
const serverSigner = ES256KSigner(serverPrivateKeyBytes, false);

console.log(`[Server] Server Agent DID: ${serverDID}`);

const issuer = new VCIssuer();
const policyValidator = new PolicyValidator(didResolver);

let serverVC = null;
let serverVP = null;
let serverInitialized = false;

async function initializeServer() {
  serverVC = await issuer.issueServiceEndpointVC(serverDID, {
    url: `http://localhost:${PORT}`,
    protocols: ['A2A', 'DID-Auth'],
    version: '1.0'
  });
  
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
  
  console.log(`[Server] Server VP 생성 완료`);
  serverInitialized = true;
}

app.get('/api/registry-address', (req, res) => {
  res.send(REGISTRY_ADDRESS);
});

app.post('/api/create-vc', async (req, res) => {
  try {
    const { vcPayload, privateKey } = req.body;
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

app.post('/api/verify-server-vp', async (req, res) => {
  try {
    const { serverVP } = req.body;
    
    if (!serverVP) {
      return res.status(400).json({ error: 'serverVP is required' });
    }
    
    const verifiedVP = await verifyPresentation(serverVP, didResolver);
    
    res.json({
      verified: true,
      issuer: verifiedVP.issuer
    });
  } catch (error) {
    console.error('[Server] Server VP 검증 실패:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/issue-vc', async (req, res) => {
  try {
    const { holderDID, taskData } = req.body;
    const vcJwt = await issuer.issueTaskLogVC(holderDID, taskData);
    
    res.json({ vcJwt });
  } catch (error) {
    console.error('VC 발급 실패:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/agent-card', async (req, res) => {
  console.log(`[Server] Agent Card 요청 수신`);
  
  if (!serverInitialized) {
    await initializeServer();
  }
  
  res.json({
    name: "Burger Server Agent",
    description: "DID 기반 양방향 인증 에이전트",
    did: serverDID,
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

app.post('/a2a/authenticate', async (req, res) => {
  const vpJwt = req.body.vp;

  if (!vpJwt) {
    return res.status(401).json({ error: "VP가 필요합니다" });
  }

  try {
    console.log(`[Server] Step 1: VP 수신 완료`);
    
    const verifiedVP = await verifyPresentation(vpJwt, didResolver);
    console.log(`[Server] Step 2: DID 문서 조회 완료`);
    
    const credential = verifiedVP.verifiablePresentation?.verifiableCredential?.[0] 
                      || verifiedVP.verifiableCredential?.[0];
    
    if (!credential) {
      throw new Error('VC를 찾을 수 없습니다');
    }
    
    console.log(`[Server] Step 3: VC 파싱 완료`);
    
    const revocationStatus = await policyValidator.checkRevocationStatus(credential);
    if (revocationStatus.revoked) {
      throw new Error(`VC가 폐기되었습니다: ${revocationStatus.reason}`);
    }
    console.log(`[Server] Step 4: 폐기 상태 확인 완료`);
    
    const complianceResult = policyValidator.checkPolicyCompliance(credential);
    if (!complianceResult.compliant) {
      throw new Error(`정책 위반: ${complianceResult.errors.join(', ')}`);
    }
    console.log(`[Server] Step 5: 정책 준수 확인 완료`);
    
    const authResult = policyValidator.authorize(credential);
    if (!authResult.authorized) {
      throw new Error('권한 없음');
    }
    console.log(`[Server] Step 6: 권한 확인 완료`);
    
    const authToken = policyValidator.generateAuthToken(authResult);
    console.log(`[Server] Step 7: 인증 토큰 생성 완료`);
    
    const clientDid = credential.credentialSubject?.id || authResult.holderDID;
    
    res.json({
      status: "success",
      message: "인증 성공",
      clientDid: clientDid,
      authToken: authToken.accessToken
    });

  } catch (e) {
    console.error("[Server] 인증 실패:", e.message);
    res.status(403).json({ error: e.message });
  }
});

app.post('/ai/task', async (req, res) => {
  try {
    const { authToken, taskType, taskData } = req.body;
    
    if (!authToken) {
      return res.status(401).json({ error: '인증 토큰이 필요합니다' });
    }
    
    console.log(`[Server] Step 8: AI Task 요청 수신 - ${taskType}`);
    
    const startTime = Date.now();
    let taskDetails = null;
    
    switch(taskType) {
      case 'OrderPizza':
        taskDetails = {
          orderId: 'ORD-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
          menu: taskData.menu || '페퍼로니 피자',
          size: taskData.size || 'L',
          price: 25000,
          estimatedDelivery: '30분',
          recommendation: '콜라 추가 (+2000원)'
        };
        break;
      
      case 'QueryStatus':
        taskDetails = {
          status: 'active',
          lastUpdate: new Date().toISOString(),
          uptime: '99.9%'
        };
        break;
      
      case 'UpdateProfile':
        taskDetails = {
          updated: true,
          fields: Object.keys(taskData || {}),
          timestamp: new Date().toISOString()
        };
        break;
      
      default:
        taskDetails = {
          message: 'Unknown task type',
          received: taskType
        };
    }
    
    const processingTime = Date.now() - startTime;
    console.log(`[Server] Step 9: AI Task 완료 (${processingTime}ms)`);
    
    res.json({
      success: true,
      taskType,
      details: taskDetails,
      processingTime,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Server AI] Task 처리 실패:', error);
    res.status(500).json({ error: 'AI task processing failed', details: error.message });
  }
});

(async () => {
  await initializeServer();
  
  app.listen(PORT, () => {
    console.log(`[Server] Agent 서버가 ${PORT}번 포트에서 실행 중입니다.`);
    console.log(`[Server] 웹 UI: http://localhost:${PORT}`);
  });
})();
