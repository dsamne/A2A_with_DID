// policy.js - 정책 검증 로직
// OAuth의 Scope & Permission 체크를 DID 방식으로 구현
// VC의 Claims를 분석하여 권한 부여 결정

const { verifyCredential } = require('did-jwt-vc');

class PolicyValidator {
  constructor(didResolver) {
    this.didResolver = didResolver;  // DID 문서 조회용 Resolver
    
    // ===== 비즈니스 정책 정의 =====
    this.policies = {
      // 필수 VC 타입: 이 타입의 VC만 인증에 사용 가능
      requiredVCTypes: ['TaskLogCredential'],
      
      // 허용된 작업 목록 (whitelist 방식)
      allowedActions: ['OrderPizza', 'QueryStatus', 'UpdateProfile'],
      
      // VC 유효 기간: 1시간 이상 지난 VC는 거부 (replay attack 방지)
      maxVCAge: 3600, // 1시간 = 3600초
    };
  }

  /**
   * VC의 Revocation Status 확인
   * OAuth의 Token Revocation과 유사하지만, 탈중앙화 방식
   * (실제로는 블록체인이나 Revocation List를 확인해야 하지만, 여기서는 단순화)
   */
  async checkRevocationStatus(vcId) {
    console.log(`[Policy] VC Revocation 상태 확인: ${vcId}`);
    
    // ===== 실제 프로덕션 구현 시 =====
    // 1. Status List 2021 표준 사용
    // 2. 블록체인에 폐기 목록 기록
    // 3. IPFS에 폐기 상태 저장
    // 여기서는 항상 유효한 것으로 처리
    return { revoked: false, reason: null };
  }

  /**
   * VC의 Claims가 정책을 준수하는지 확인
   * OAuth의 Scope Validation과 유사
   */
  checkPolicyCompliance(claims, requiredSchema) {
    console.log(`[Policy] 정책 준수 확인 중...`);
    
    const errors = [];  // 정책 위반 내역 수집

    // ===== 검증 1: VC 타입 확인 =====
    // VC가 우리가 요구하는 타입(TaskLogCredential)인지 확인
    const vcTypes = claims.type || claims.vc?.type || [];
    const hasRequiredType = this.policies.requiredVCTypes.some(
      required => vcTypes.includes(required)
    );
    if (!hasRequiredType) {
      errors.push(`필수 VC 타입 누락: ${this.policies.requiredVCTypes.join(', ')}`);
    }

    // ===== 검증 2: Task Action 확인 (중요!) =====
    // 클라이언트가 요청한 작업이 허용 목록에 있는지 확인
    const credentialSubject = claims.credentialSubject || claims.vc?.credentialSubject || {};
    const taskAction = credentialSubject.taskLog?.action;
    if (taskAction && !this.policies.allowedActions.includes(taskAction)) {
      errors.push(`허용되지 않은 작업: ${taskAction}`);
    }

    // ===== 검증 3: VC 발급 시간 확인 =====
    // 너무 오래된 VC는 거부 (Replay Attack 방지)
    const issuedAt = credentialSubject.issuedAt;
    if (issuedAt) {
      const ageInSeconds = (Date.now() - new Date(issuedAt).getTime()) / 1000;
      if (ageInSeconds > this.policies.maxVCAge) {
        errors.push(`VC가 만료됨 (${Math.floor(ageInSeconds)}초 경과, 최대 ${this.policies.maxVCAge}초)`);
      }
    }

    // 4. 스키마 검증 (requiredSchema가 있는 경우)
    if (requiredSchema) {
      for (const [key, expectedType] of Object.entries(requiredSchema)) {
        if (!(key in credentialSubject)) {
          errors.push(`필수 필드 누락: ${key}`);
        }
      }
    }

    if (errors.length > 0) {
      console.log(`[Policy] 정책 위반 발견:`, errors);
      return { compliant: false, errors };
    }

    console.log(`[Policy] 정책 준수 확인 완료`);
    return { compliant: true, errors: [] };
  }

  /**
   * Claims를 기반으로 권한 부여 결정
   */
  authorize(claims) {
    console.log(`[Policy] 권한 부여 결정 중...`);
    
    // Claims에서 역할/권한 추출
    const credentialSubject = claims.credentialSubject || claims.vc?.credentialSubject || {};
    const taskAction = credentialSubject.taskLog?.action;
    const holderDID = credentialSubject.id;

    // 권한 매핑
    const permissions = {
      OrderPizza: ['read:menu', 'write:order'],
      QueryStatus: ['read:status'],
      UpdateProfile: ['write:profile']
    };

    const grantedPermissions = permissions[taskAction] || [];

    console.log(`[Policy] 권한 부여: ${grantedPermissions.join(', ')}`);
    
    return {
      authorized: true,
      holderDID,
      action: taskAction,
      permissions: grantedPermissions,
      expiresIn: 3600 // 1시간
    };
  }

  /**
   * Authorization Response Token 생성
   */
  generateAuthToken(authResult) {
    const token = {
      tokenType: 'Bearer',
      accessToken: Buffer.from(JSON.stringify({
        did: authResult.holderDID,
        action: authResult.action,
        permissions: authResult.permissions,
        exp: Math.floor(Date.now() / 1000) + authResult.expiresIn
      })).toString('base64'),
      expiresIn: authResult.expiresIn
    };

    console.log(`[Policy] Authorization Token 발급`);
    return token;
  }
}

module.exports = PolicyValidator;
