export class ManualActionRequiredError extends Error {
  constructor(public readonly reason: 'CAPTCHA' | 'SECURITY_CHECK' | 'LOGIN_REQUIRED' | 'SESSION_EXPIRED', message: string) {
    super(message);
    this.name = 'ManualActionRequiredError';
  }
}

export class AutomationError extends Error {
  constructor(public readonly userMessage: string, technicalMessage?: string) {
    super(technicalMessage ?? userMessage);
    this.name = 'AutomationError';
  }
}
