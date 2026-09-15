export interface TargetGroup {
  id: string; name: string; description: string | null; location: string | null;
  score: number | null; membersCount: number | null; membershipStatus: string;
  postingEnabled: boolean; decisionStatus: string; blacklist: unknown;
}
export interface TargetRules {
  locations?: string[]; requiredKeywords?: string[]; minScore?: number | null;
  minMembers?: number | null; includeGroupIds?: string[]; excludeGroupIds?: string[];
}
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();
export function matchesTargeting(group: TargetGroup, rules: TargetRules = {}) {
  if (group.membershipStatus !== 'JOINED' || !group.postingEnabled || group.blacklist || group.decisionStatus === 'MANUALLY_REJECTED') return false;
  if (rules.excludeGroupIds?.includes(group.id)) return false;
  // Explicit inclusion overrides metrics, but never exclusions, membership or blacklist.
  if (rules.includeGroupIds?.includes(group.id)) return true;
  if (rules.minScore != null && (group.score == null || group.score < rules.minScore)) return false;
  if (rules.minMembers != null && (group.membersCount == null || group.membersCount < rules.minMembers)) return false;
  const text = normalize(`${group.name} ${group.description ?? ''}`);
  if (rules.requiredKeywords?.some(word => !text.includes(normalize(word)))) return false;
  if (rules.locations?.length && (!group.location || !rules.locations.some(place => normalize(group.location!).includes(normalize(place))))) return false;
  return true;
}
