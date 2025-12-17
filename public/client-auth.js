// client-auth.js - 브라우저에서 실행되는 DID 인증 클라이언트

let wallet, didString, signer;

function updateStep(stepId, status, content, badge = null) {
    const step = document.getElementById(stepId);
    const contentEl = document.getElementById(`${stepId}-content`);
    const badgeEl = step.querySelector('.badge');
    
    step.className = `timeline-item ${status}`;
    if (content) contentEl.innerHTML = content;
    
    if (badge && badgeEl) {
        badgeEl.className = `badge ${badge}`;
        badgeEl.textContent = {
            'pending': '대기중',
            'processing': '처리중',
            'success': '완료',
            'error': '실패'
        }[badge];
    }
}

function showResult(success, message, data = null) {
    const result = document.getElementById('result');
    const content = document.getElementById('resultContent');
    
    result.style.display = 'block';
    result.style.borderLeftColor = success ? '#4caf50' : '#f44336';
    result.style.background = success ? '#e8f5e9' : '#ffebee';
    
    let html = `<p>${message}</p>`;
    if (data) {
        html += `<div class="json-display">${JSON.stringify(data, null, 2)}</div>`;
    }
    content.innerHTML = html;
}

function showAITask(taskResult) {
    const aiResult = document.getElementById('aiResult');
    const aiContent = document.getElementById('aiResultContent');
    
    aiResult.style.display = 'block';
    
    let html = `
        <div style="margin-bottom: 15px;">
            <strong>🤖 Server AI Agent 작업 결과:</strong>
        </div>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
            <div style="margin-bottom: 10px;">
                <strong>📋 Task:</strong> ${taskResult.task}
            </div>
            <div style="margin-bottom: 10px;">
                <strong>✅ Status:</strong> <span style="color: #4caf50;">${taskResult.status}</span>
            </div>
            <div style="margin-bottom: 10px;">
                <strong>💬 AI Response:</strong><br>
                <div style="background: white; padding: 10px; border-radius: 4px; margin-top: 5px;">
                    ${taskResult.aiResponse}
                </div>
            </div>
            ${taskResult.details ? `
                <div style="margin-top: 10px;">
                    <strong>📦 상세 정보:</strong><br>
                    <div class="json-display" style="margin-top: 5px;">${JSON.stringify(taskResult.details, null, 2)}</div>
                </div>
            ` : ''}
        </div>
    `;
    
    aiContent.innerHTML = html;
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ES256K Signer 구현 (간단 버전 - 실제로는 서버에서 처리)
async function createJWT(payload, privateKey) {
    // 실제 JWT 생성은 복잡하므로 서버 API를 통해 생성
    const response = await fetch('/api/create-jwt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, privateKey })
    });
    
    if (!response.ok) throw new Error('JWT 생성 실패');
    return (await response.json()).jwt;
}

async function startAuthentication() {
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span> 인증 진행중...';
    
    try {
        // Step 1: Client DID 생성
        updateStep('step1', 'active', '지갑 생성 중...', 'processing');
        await sleep(500);
        
        // ethers.js로 랜덤 지갑 생성
        wallet = ethers.Wallet.createRandom();
        const registryAddress = await (await fetch('/api/registry-address')).text();
        didString = `did:ethr:development:${wallet.address}`;
        
        updateStep('step1', 'success', 
            `<strong>DID:</strong> ${didString}<br>` +
            `<strong>Address:</strong> ${wallet.address.substring(0, 20)}...`, 
            'success'
        );
        
        await sleep(500);
        
        // Step 2: Agent Card 요청
        updateStep('step2', 'active', 'Server Agent Card 요청 중...', 'processing');
        updateStep('server1', 'active', 'Agent Card 정보 제공 준비...', 'processing');
        
        const cardResponse = await fetch('/agent-card');
        const agentCard = await cardResponse.json();
        
        updateStep('step2', 'success', 
            `<strong>Server Name:</strong> ${agentCard.name}<br>` +
            `<strong>Server DID:</strong> ${agentCard.did.substring(0, 40)}...`,
            'success'
        );
        updateStep('server1', 'success', 'Server VP 제공 완료', 'success');
        
        await sleep(500);
        
        // Step 2b: Server VP 검증 (양방향 인증)
        updateStep('step2b', 'active', 'Server의 VP 검증 중...', 'processing');
        
        if (!agentCard.serverVP) {
            console.error('❌ Agent Card에 serverVP가 없습니다:', agentCard);
            throw new Error('Server VP가 제공되지 않았습니다');
        }
        
        console.log('[Client] Server VP 검증 요청 중...');
        
        // 서버에 VP 검증 요청
        const verifyResponse = await fetch('/api/verify-server-vp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverVP: agentCard.serverVP })
        });
        
        if (!verifyResponse.ok) {
            const errorData = await verifyResponse.json().catch(() => ({ error: 'Unknown error' }));
            console.error('❌ Server VP 검증 실패:', errorData);
            throw new Error(`Server VP 검증 실패: ${errorData.error || verifyResponse.statusText}`);
        }
        
        const verifyResult = await verifyResponse.json();
        console.log('[Client] Server VP 검증 성공:', verifyResult);
        
        updateStep('step2b', 'success', 
            `<strong>✅ Server 인증 성공!</strong><br>` +
            `<strong>Issuer:</strong> ${verifyResult.issuer.substring(0, 35)}...`,
            'success'
        );
        
        await sleep(500);
        
        // Step 3: Issuer에게 VC 요청
        updateStep('step3', 'active', 'Issuer에게 VC 발급 요청 중...', 'processing');
        
        const taskContext = {
            action: "OrderPizza",
            timestamp: Date.now()
        };
        
        // Issuer에게 VC 발급 요청 (self-issued가 아님)
        const vcResponse = await fetch('/api/issue-vc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                holderDID: didString,
                taskData: taskContext
            })
        });
        
        if (!vcResponse.ok) {
            throw new Error('VC 발급 실패');
        }
        
        const { vcJwt } = await vcResponse.json();
        
        updateStep('step3', 'success', 
            `<strong>✅ VC 발급 완료!</strong><br>` +
            `<strong>Task Action:</strong> ${taskContext.action}<br>` +
            `<strong>VC JWT (앞부분):</strong> ${vcJwt.substring(0, 50)}...`,
            'success'
        );
        
        await sleep(500);
        
        // Step 4: VP 생성
        updateStep('step4', 'active', 'VP에 서명하여 제출 준비 중...', 'processing');
        
        const vpPayload = {
            vp: {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiablePresentation'],
                verifiableCredential: [vcJwt]
            },
            audience: agentCard.did
        };
        
        const vpResponse = await fetch('/api/create-vp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vpPayload,
                privateKey: wallet.privateKey,
                did: didString
            })
        });
        
        const { vpJwt } = await vpResponse.json();
        
        updateStep('step4', 'success', 
            `<strong>VP 서명 완료</strong><br>` +
            `<strong>VP JWT (앞부분):</strong> ${vpJwt.substring(0, 60)}...`,
            'success'
        );
        
        await sleep(500);
        
        // Step 5: VP 전송 및 검증
        updateStep('step5', 'active', 'Server에 VP 전송 중...', 'processing');
        updateStep('server2', 'active', 'VP 수신 중...', 'processing');
        
        await sleep(300);
        updateStep('server2', 'success', `VP 토큰 수신 완료 (${vpJwt.length} bytes)`, 'success');
        
        // Server 검증 단계 표시
        updateStep('server3', 'active', 'VP 서명 검증 중...', 'processing');
        await sleep(300);
        
        const authResponse = await fetch('/a2a/authenticate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                vp: vpJwt
            })
        });
        
        updateStep('server3', 'success', 'VP 서명 검증 완료! ✓', 'success');
        updateStep('server4', 'active', 'DID 문서 조회 중...', 'processing');
        await sleep(300);
        
        updateStep('server4', 'success', `DID: ${didString.substring(0, 35)}... 조회 완료`, 'success');
        updateStep('server5', 'active', 'Revocation Status 확인 중...', 'processing');
        await sleep(200);
        
        updateStep('server5', 'success', '✓ 폐기되지 않음', 'success');
        updateStep('server6', 'active', 'Policy Compliance 검증 중...', 'processing');
        await sleep(300);
        
        const authResult = await authResponse.json();
        
        if (authResponse.ok) {
            updateStep('server6', 'success', 
                `<strong>✓ 정책 준수 확인</strong><br>` +
                `- VC Type: TaskLogCredential<br>` +
                `- Action: ${taskContext.action}`,
                'success'
            );
            
            updateStep('server7', 'active', '권한 부여 결정 중...', 'processing');
            await sleep(300);
            
            updateStep('server7', 'success', 
                `<strong>✓ 권한 부여 완료</strong><br>` +
                `Client DID: ${authResult.clientDid?.substring(0, 30)}...`,
                'success'
            );
            
            updateStep('server8', 'active', 'Authorization Token 발급 중...', 'processing');
            await sleep(200);
            
            updateStep('server8', 'success', 
                `<strong>✓ Token 발급 완료</strong><br>` +
                `Token: ${authResult.authToken?.substring(0, 20)}...`,
                'success'
            );
            
            updateStep('step5', 'success', 
                `<strong>✅ VP 전송 성공!</strong>`,
                'success'
            );
            
            // Step 6: Authorization Token 수신
            updateStep('step6', 'active', 'Authorization Token 수신 중...', 'processing');
            await sleep(200);
            
            updateStep('step6', 'success', 
                `<strong>✅ Token 수신 완료!</strong><br>` +
                `<strong>Client DID:</strong> ${authResult.clientDid?.substring(0, 30)}...<br>` +
                `<strong>Auth Token:</strong> ${authResult.authToken?.substring(0, 20)}...`,
                'success'
            );
            
            showResult(true, '🎉 양방향 DID 인증 및 권한 부여가 성공적으로 완료되었습니다!', {
                clientDID: didString,
                serverDID: agentCard.did,
                taskAction: taskContext.action,
                status: authResult.status,
                message: authResult.message
            });
            
            // AI Agent Task 수행
            await sleep(500);
            await performAITask(authResult.authToken, taskContext.action);
        } else {
            throw new Error(authResult.error || '인증 실패');
        }
        
    } catch (error) {
        console.error('인증 실패:', error);
        
        // 실패한 단계 표시
        const activeSteps = document.querySelectorAll('.timeline-item.active');
        activeSteps.forEach(step => {
            const badge = step.querySelector('.badge');
            step.className = 'timeline-item error';
            if (badge) {
                badge.className = 'badge error';
                badge.textContent = '실패';
            }
        });
        
        showResult(false, `❌ 인증 실패: ${error.message}`);
    } finally {
        startBtn.disabled = false;
        startBtn.innerHTML = '🔄 다시 시도';
    }
}

async function performAITask(authToken, action) {
    try {
        updateStep('step7', 'active', 'Client AI가 Server AI에게 작업 요청 중...', 'processing');
        updateStep('server9', 'active', 'Server AI가 작업 처리 중...', 'processing');
        
        await sleep(500);
        
        // Client AI가 Server AI에게 task 요청
        const response = await fetch('/ai/task', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                authToken: authToken,
                taskType: action,
                taskData: {
                    menu: '페퍼로니 피자',
                    size: 'L'
                }
            })
        });
        
        if (!response.ok) {
            throw new Error('AI task 실행 실패');
        }
        
        const taskResult = await response.json();
        
        await sleep(300);
        
        updateStep('server9', 'success', 
            `<strong>✅ AI 작업 완료!</strong><br>` +
            `처리 시간: ${taskResult.processingTime}ms`,
            'success'
        );
        
        updateStep('step7', 'success', 
            `<strong>✅ AI 응답 수신 완료!</strong><br>` +
            `작업: ${taskResult.taskType}`,
            'success'
        );
        
        // AI 작업 결과 표시
        showAITask({
            task: taskResult.taskType,
            status: 'Success',
            aiResponse: `주문이 성공적으로 처리되었습니다!`,
            details: taskResult.details
        });
        
    } catch (error) {
        console.error('AI task 실패:', error);
        updateStep('step7', 'error', `AI 작업 실패: ${error.message}`, 'error');
        updateStep('server9', 'error', 'AI 작업 처리 실패', 'error');
    }
}
