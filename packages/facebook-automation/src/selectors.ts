export const selectors = {
  accountMenu: ['[aria-label="Account"]', '[aria-label="الحساب"]'],
  loginInputs: ['input[name="email"]', 'input[name="pass"]'],
  joinButtons: [
    'role=button[name=/^(Join group|Join Group|انضمام إلى المجموعة|الانضمام إلى المجموعة)$/i]',
    '[aria-label*="Join group"]', '[aria-label*="الانضمام"]',
  ],
  pendingJoinText: [/Pending/i, /في انتظار الموافقة/i, /تم إرسال طلب الانضمام/i],
  joinedText: [/Joined/i, /تم الانضمام/i],
  composer: [
    'role=button[name=/Write something|إنشاء منشور|بم تفكر/i]',
    '[aria-label*="Create a public post"]', '[aria-label*="إنشاء منشور"]',
  ],
  composerTextbox: ['role=textbox', '[contenteditable="true"][role="textbox"]'],
  postButton: ['role=button[name=/^(Post|نشر)$/i]'],
  photoInput: ['input[type="file"][accept*="image"]'],
  membershipDialog: ['role=dialog'],
  submitAnswers: ['role=button[name=/Submit|إرسال|إرسال الطلب/i]'],
} as const;
