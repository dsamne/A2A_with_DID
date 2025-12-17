// issuer.js - VC 발급 기관 (Issuer)
// OAuth의 Authorization Server 역할을 DID 방식으로 구현
// 중앙 서버 없이 독립적으로 VC(Verifiable Credential)를 발급

const { ethers } = require("ethers");
const { createVerifiableCredentialJwt } = require("did-jwt-vc");
const { ES256KSigner } = require("did-jwt");

class VCIssuer {
  constructor() {
    // ===== Issuer의 자체 DID 생성 =====
    // Issuer도 고유한 신원(DID)을 가져야 발급한 VC의 신뢰성 확보 가능
    this.wallet = ethers.Wallet.createRandom();  // 랜덤 지갑 생성
    this.did = `did:ethr:development:${this.wallet.address}`;  // DID 형식으로 변환
    
    const privateKeyHex = this.wallet.privateKey.startsWith('0x') 
      ? this.wallet.privateKey.slice(2) 
      : this.wallet.privateKey;
    const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
    this.signer = ES256KSigner(privateKeyBytes, false);
    
    console.log(`[Issuer] 초기화 완료 - DID: ${this.did}`);
  }

  /**
   * TaskLog VC 발급
   * OAuth의 Access Token 발급과 유사하지만, 블록체인 기반 신원 증명
   * @param {string} holderDID - VC를 받을 주체의 DID (Client Agent)
   * @param {object} taskData - Task 내용 (action, timestamp 등)
   */
  async issueTaskLogVC(holderDID, taskData) {
    console.log(`[Issuer] ${holderDID}에게 TaskLog VC 발급 중...`);
    
    // ===== VC Payload 구성 =====
    const vcPayload = {
      sub: holderDID,  // subject: VC 소유자의 DID
      nbf: Math.floor(Date.now() / 1000),  // not before: 유효 시작 시간
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],  // W3C 표준 컨텍스트
        type: ['VerifiableCredential', 'TaskLogCredential'],  // VC 타입 (정책 검증에 사용)
        credentialSubject: {  // 실제 증명 내용
          id: holderDID,
          taskLog: taskData,  // 수행할 작업 정보 (OrderPizza 등)
          issuedAt: new Date().toISOString()  // 발급 시간 (만료 검증용)
        }
      }
    };

    const vcJwt = await createVerifiableCredentialJwt(
      vcPayload,
      { did: this.did, signer: this.signer }
    );

    console.log(`[Issuer] VC 발급 완료`);
    return vcJwt;
  }

  /**
   * Service Endpoint VC 발급 (Server Agent용)
   */
  async issueServiceEndpointVC(serverDID, serviceInfo) {
    console.log(`[Issuer] ${serverDID}에게 ServiceEndpoint VC 발급 중...`);
    
    const vcPayload = {
      sub: serverDID,
      nbf: Math.floor(Date.now() / 1000),
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'ServiceEndpointCredential'],
        credentialSubject: {
          id: serverDID,
          serviceEndpoint: serviceInfo,
          issuedAt: new Date().toISOString()
        }
      }
    };

    const vcJwt = await createVerifiableCredentialJwt(
      vcPayload,
      { did: this.did, signer: this.signer }
    );

    console.log(`[Issuer] ServiceEndpoint VC 발급 완료`);
    return vcJwt;
  }
}

module.exports = VCIssuer;
