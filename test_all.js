// test_all.js - 전체 시스템 통합 테스트
const { spawn } = require('child_process');
const path = require('path');

console.log("🧪 A2A DID 인증 시스템 통합 테스트 시작\n");

// 1. 블록체인 시작
console.log("1️⃣ 블록체인 시작 중...");
const blockchain = spawn('node', ['1_chain.js'], { 
  cwd: __dirname,
  stdio: ['inherit', 'pipe', 'pipe']
});

blockchain.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(output);
  
  // Registry가 배포되면 서버 시작
  if (output.includes('Registry 주소')) {
    setTimeout(startServer, 2000);
  }
});

blockchain.stderr.on('data', (data) => {
  const err = data.toString();
  if (!err.includes('µWS') && !err.includes('Falling back')) {
    console.error(err);
  }
});

let server, client;

function startServer() {
  console.log("\n[2] Server Agent 시작 중...");
  server = spawn('node', ['2_server.js'], {
    cwd: __dirname,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  
  server.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    
    // 서버가 시작되면 클라이언트 실행
    if (output.includes('실행 중')) {
      setTimeout(startClient, 1000);
    }
  });
  
  server.stderr.on('data', (data) => {
    console.error('[Server Error]', data.toString());
  });
}

function startClient() {
  console.log("\n[3] Client Agent 시작 중...");
  client = spawn('node', ['3_client.js'], {
    cwd: __dirname,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  
  client.stdout.on('data', (data) => {
    console.log(data.toString());
  });
  
  client.stderr.on('data', (data) => {
    console.error('[Client Error]', data.toString());
  });
  
  client.on('close', (code) => {
    console.log(`\n테스트 완료 (Exit Code: ${code})`);
    
    // 정리
    setTimeout(() => {
      console.log("\n프로세스 정리 중...");
      if (server) server.kill();
      if (blockchain) blockchain.kill();
      process.exit(code);
    }, 1000);
  });
}

// Ctrl+C 처리
process.on('SIGINT', () => {
  console.log("\n[경고] 테스트 중단");
  if (client) client.kill();
  if (server) server.kill();
  if (blockchain) blockchain.kill();
  process.exit();
});
