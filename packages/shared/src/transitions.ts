import type { MembershipStatus, PostStatus } from './types.js';

const membershipTransitions: Record<MembershipStatus, MembershipStatus[]> = {
  NOT_JOINED: ['JOINING', 'JOINED', 'MANUAL_ACTION_REQUIRED'],
  JOINING: ['NEEDS_QUESTIONS', 'JOIN_REQUESTED', 'WAITING_ADMIN', 'JOINED', 'JOIN_FAILED', 'MANUAL_ACTION_REQUIRED'],
  NEEDS_QUESTIONS: ['QUESTIONS_ANSWERED', 'JOIN_FAILED', 'MANUAL_ACTION_REQUIRED'],
  QUESTIONS_ANSWERED: ['JOINING', 'JOIN_REQUESTED', 'WAITING_ADMIN', 'JOINED', 'JOIN_FAILED', 'MANUAL_ACTION_REQUIRED'],
  JOIN_REQUESTED: ['WAITING_ADMIN', 'JOINED', 'JOIN_REJECTED', 'MANUAL_ACTION_REQUIRED'],
  WAITING_ADMIN: ['JOINED', 'JOIN_REJECTED', 'MANUAL_ACTION_REQUIRED'],
  JOINED: ['NOT_JOINED', 'MANUAL_ACTION_REQUIRED'],
  JOIN_REJECTED: ['JOINING'],
  JOIN_FAILED: ['JOINING', 'MANUAL_ACTION_REQUIRED'],
  MANUAL_ACTION_REQUIRED: ['NOT_JOINED', 'JOINING', 'JOINED'],
};

const postTransitions: Record<PostStatus, PostStatus[]> = {
  QUEUED: ['POSTING', 'SKIPPED', 'WOULD_POST', 'MANUAL_ACTION_REQUIRED'],
  POSTING: ['POSTED', 'PENDING_ADMIN_APPROVAL', 'FAILED', 'MANUAL_ACTION_REQUIRED'],
  POSTED: ['APPROVED', 'REJECTED', 'MANUAL_ACTION_REQUIRED'],
  PENDING_ADMIN_APPROVAL: ['APPROVED', 'REJECTED', 'MANUAL_ACTION_REQUIRED'],
  APPROVED: [], REJECTED: [], FAILED: ['QUEUED', 'POSTING'], MANUAL_ACTION_REQUIRED: ['QUEUED', 'POSTING', 'SKIPPED'], SKIPPED: ['QUEUED'], WOULD_POST: ['QUEUED'],
};

export function assertMembershipTransition(from: MembershipStatus, to: MembershipStatus) {
  if (!membershipTransitions[from].includes(to)) throw new Error(`Invalid membership transition: ${from} -> ${to}`);
}

export function assertPostTransition(from: PostStatus, to: PostStatus) {
  if (!postTransitions[from].includes(to)) throw new Error(`Invalid post transition: ${from} -> ${to}`);
}
