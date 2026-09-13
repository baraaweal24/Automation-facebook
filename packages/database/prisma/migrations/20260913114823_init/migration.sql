-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FacebookSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "profilePath" TEXT NOT NULL,
    "lastCheckedAt" DATETIME,
    "lastConnectedAt" DATETIME,
    "manualReason" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SearchKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastSearchedAt" DATETIME,
    "groupsFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "facebookGroupId" TEXT,
    "canonicalUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "privacy" TEXT,
    "visibility" TEXT,
    "membersCount" INTEGER,
    "activityPerDay" REAL,
    "description" TEXT,
    "location" TEXT,
    "createdOnFacebook" DATETIME,
    "score" REAL,
    "decisionStatus" TEXT NOT NULL DEFAULT 'NEW',
    "decisionReasonJson" TEXT,
    "membershipStatus" TEXT NOT NULL DEFAULT 'NOT_JOINED',
    "postingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minDaysBetweenPosts" INTEGER,
    "lastAnalyzedAt" DATETIME,
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GroupKeyword" (
    "groupId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "foundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("groupId", "keywordId"),
    CONSTRAINT "GroupKeyword_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SearchKeyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "membersCount" INTEGER,
    "postsPerDay" REAL,
    "recentPostScore" REAL,
    "avgReactions" REAL,
    "avgComments" REAL,
    "keywordRelevance" REAL,
    "locationRelevance" REAL,
    "measuredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupMetric_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT,
    "minMembers" INTEGER,
    "maxMembers" INTEGER,
    "minActivityPerDay" REAL,
    "minScore" REAL NOT NULL DEFAULT 60,
    "allowedPrivacyJson" TEXT NOT NULL DEFAULT '["PUBLIC","PRIVATE"]',
    "requireJobKeywords" BOOLEAN NOT NULL DEFAULT true,
    "allowedKeywordsJson" TEXT NOT NULL DEFAULT '[]',
    "blockedKeywordsJson" TEXT NOT NULL DEFAULT '[]',
    "allowedLocationsJson" TEXT NOT NULL DEFAULT '[]',
    "blockedLocationsJson" TEXT NOT NULL DEFAULT '[]',
    "allowedJobTypesJson" TEXT NOT NULL DEFAULT '[]',
    "customPostRequired" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GroupRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupAnalysis_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_JOINED',
    "requestedAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "questionsHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "optionsJson" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "MembershipQuestion_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MembershipRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "MembershipQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MembershipRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "salary" TEXT,
    "employmentType" TEXT NOT NULL,
    "experience" TEXT,
    "gender" TEXT,
    "ageRange" TEXT,
    "description" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "benefits" TEXT,
    "contactMethod" TEXT NOT NULL,
    "whatsapp" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "applyLink" TEXT,
    "imagePath" TEXT,
    "finalText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JobTargetingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "locationsJson" TEXT NOT NULL DEFAULT '[]',
    "requiredKeywordsJson" TEXT NOT NULL DEFAULT '[]',
    "minScore" REAL,
    "minMembers" INTEGER,
    "includeGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "excludeGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "JobTargetingRule_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignGroup" (
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "reasonJson" TEXT,

    PRIMARY KEY ("campaignId", "groupId"),
    CONSTRAINT "CampaignGroup_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "content" TEXT NOT NULL,
    "facebookPostId" TEXT,
    "facebookUrl" TEXT,
    "repostNumber" INTEGER NOT NULL DEFAULT 0,
    "originalPostId" TEXT,
    "postedAt" DATETIME,
    "approvedAt" DATETIME,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_originalPostId_fkey" FOREIGN KEY ("originalPostId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostStatusHistory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "payloadJson" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseExpiresAt" DATETIME,
    "heartbeatAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "status" TEXT,
    "detailsJson" TEXT,
    "source" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "valueJson" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Blacklist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Blacklist_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupNote_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "technical" TEXT,
    "stack" TEXT,
    "groupId" TEXT,
    "postId" TEXT,
    "taskId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ErrorLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AutomationTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "taskId" TEXT,
    "groupId" TEXT,
    "postId" TEXT,
    "errorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Screenshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AutomationTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Screenshot_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Screenshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Screenshot_errorId_fkey" FOREIGN KEY ("errorId") REFERENCES "ErrorLog" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchKeyword_keyword_key" ON "SearchKeyword"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "Group_facebookGroupId_key" ON "Group"("facebookGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_canonicalUrl_key" ON "Group"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Group_decisionStatus_membershipStatus_idx" ON "Group"("decisionStatus", "membershipStatus");

-- CreateIndex
CREATE INDEX "Group_score_membersCount_idx" ON "Group"("score", "membersCount");

-- CreateIndex
CREATE INDEX "GroupMetric_groupId_measuredAt_idx" ON "GroupMetric"("groupId", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "GroupRule_groupId_key" ON "GroupRule"("groupId");

-- CreateIndex
CREATE INDEX "GroupAnalysis_groupId_createdAt_idx" ON "GroupAnalysis"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipRequest_status_lastCheckedAt_idx" ON "MembershipRequest"("status", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipQuestion_requestId_position_key" ON "MembershipQuestion"("requestId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipAnswer_questionId_key" ON "MembershipAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "JobTargetingRule_jobId_key" ON "JobTargetingRule"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "PostTemplate_name_key" ON "PostTemplate"("name");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_status_lastCheckedAt_idx" ON "Post"("status", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_jobId_groupId_repostNumber_key" ON "Post"("jobId", "groupId", "repostNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTask_idempotencyKey_key" ON "AutomationTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationTask_status_runAt_priority_idx" ON "AutomationTask"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "AutomationTask_leaseExpiresAt_idx" ON "AutomationTask"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Notification_readAt_createdAt_idx" ON "Notification"("readAt", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Blacklist_groupId_key" ON "Blacklist"("groupId");

-- CreateIndex
CREATE INDEX "ErrorLog_resolvedAt_createdAt_idx" ON "ErrorLog"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Screenshot_createdAt_idx" ON "Screenshot"("createdAt");
