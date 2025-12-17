// 1_chain.js - 로컬 블록체인 & DID Registry 배포
// 실제 프로덕션에서는 Sepolia/Mainnet을 사용하지만,
// 테스트를 위해 로컬 Ganache 블록체인 사용

const Ganache = require("ganache");
const { ethers } = require("ethers");
const fs = require("fs");
// ethr-did-registry: DID 문서를 블록체인에 기록/조회하는 스마트 컨트랙트
const EthereumDIDRegistry = require("ethr-did-registry");

async function startChain() {
  // ===== 1단계: Ganache 실행 (로컬 이더리움 구동) =====
  // Ganache = 개발용 로컬 블록체인 (즉시 트랜잭션 처리, 가스비 없음)
  const server = Ganache.server({
    logging: { quiet: true },  // 로그 최소화
    wallet: { totalAccounts: 5, defaultBalance: 1000 }  // 테스트 계정 5개, 각 1000 ETH
  });

  // ===== 8545 포트에서 블록체인 시작 =====
  // 이 포트로 모든 Agent가 블록체인에 접근
  server.listen(8545, async (err) => {
    if (err) throw err;
    console.log("[Blockchain] 로컬 이더리움이 실행되었습니다 (http://127.0.0.1:8545)");

    // ===== 2단계: 관리자 지갑 연결 =====
    // 스마트 컨트랙트를 배포하려면 트랜잭션을 보낼 지갑 필요
    const provider = new ethers.providers.JsonRpcProvider("http://127.0.0.1:8545");
    const signer = provider.getSigner(0);  // Ganache의 첫 번째 계정 사용

    // ===== 3단계: DID Registry 스마트 컨트랙트 배포 =====
    // DID Registry = DID 문서를 블록체인에 기록하는 컨트랙트
    // 모든 Agent의 DID는 이 컨트랙트를 통해 조회 가능
    console.log("[Blockchain] DID Registry 컨트랙트 배포 중...");
    const factory = new ethers.ContractFactory(
      EthereumDIDRegistry.abi,        // 컨트랙트 인터페이스
      EthereumDIDRegistry.bytecode,   // 컴파일된 바이트코드
      signer                          // 배포자 지갑
    );
    const contract = await factory.deploy();  // 블록체인에 배포
    await contract.deployed();                // 배포 완료 대기

    // ===== 4단계: 배포된 주소 저장 =====
    // 모든 Agent가 같은 Registry 주소를 사용해야 서로의 DID를 조회 가능
    console.log(`[Blockchain] Registry 주소: ${contract.address}`);
    fs.writeFileSync("registry_address.txt", contract.address);  // 파일에 저장
    console.log("[경고] 이 터미널을 끄지 마세요! (블록체인이 꺼집니다)");
  });
}

startChain();
