export const GROUP_DECISIONS = ['NEW', 'ANALYZING', 'ACCEPTED_BY_RULES', 'REJECTED_BY_RULES', 'MANUALLY_ACCEPTED', 'MANUALLY_REJECTED'] as const;
export const MEMBERSHIP_STATUSES = ['NOT_JOINED', 'JOINING', 'NEEDS_QUESTIONS', 'QUESTIONS_ANSWERED', 'JOIN_REQUESTED', 'WAITING_ADMIN', 'JOINED', 'JOIN_REJECTED', 'JOIN_FAILED', 'MANUAL_ACTION_REQUIRED'] as const;
export const POST_STATUSES = ['QUEUED', 'POSTING', 'POSTED', 'PENDING_ADMIN_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'MANUAL_ACTION_REQUIRED', 'SKIPPED', 'WOULD_POST'] as const;
export const TASK_STATUSES = ['QUEUED', 'RUNNING', 'RETRY', 'PAUSED', 'COMPLETED', 'FAILED', 'MANUAL_ACTION_REQUIRED', 'CANCELLED'] as const;
export const TASK_TYPES = ['DISCOVER_GROUPS', 'ANALYZE_GROUP', 'JOIN_GROUP', 'SUBMIT_GROUP_QUESTIONS', 'CHECK_JOIN_STATUS', 'PUBLISH_JOB', 'PUBLISH_POST', 'CHECK_POST_STATUS', 'REFRESH_GROUP_STATS', 'CLEANUP_SCREENSHOTS', 'CHECK_FACEBOOK_SESSION'] as const;
export type GroupDecision = typeof GROUP_DECISIONS[number];
export type MembershipStatus = typeof MEMBERSHIP_STATUSES[number];
export type PostStatus = typeof POST_STATUSES[number];
export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskType = typeof TASK_TYPES[number];
export type ActionSource = 'AUTOMATION' | 'USER';

export interface GroupMetrics {
  members?: number | null;
  activity?: number | null;
  engagement?: number | null;
  keywordRelevance?: number | null;
  locationRelevance?: number | null;
}

export interface ScoreWeights {
  members: number;
  activity: number;
  engagement: number;
  keywordRelevance: number;
  locationRelevance: number;
}

export interface GroupRules {
  minMembers?: number | null;
  maxMembers?: number | null;
  minActivity?: number | null;
  minScore: number;
  allowedPrivacy: string[];
  requireJobKeywords: boolean;
  allowedKeywords: string[];
  blockedKeywords: string[];
  allowedLocations: string[];
  blockedLocations: string[];
}
