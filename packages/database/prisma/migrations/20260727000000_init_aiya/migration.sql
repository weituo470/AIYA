-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "theatre_students" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "normalizedNickname" TEXT NOT NULL,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'create-theatre',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theatre_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theatre_voiceprints" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'aiya-browser-pcm-v1',
    "embedding" JSONB NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "lastScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theatre_voiceprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theatre_sessions" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "chatMessages" JSONB NOT NULL DEFAULT '[]',
    "currentApp" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theatre_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theatre_tasks" (
    "id" TEXT NOT NULL,
    "diagnosticId" TEXT NOT NULL,
    "clientTaskId" TEXT,
    "interactionId" TEXT,
    "userKey" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "studentId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "appId" TEXT,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'started',
    "stage" TEXT NOT NULL DEFAULT 'received',
    "idea" TEXT NOT NULL DEFAULT '',
    "request" JSONB NOT NULL DEFAULT '{}',
    "currentApp" JSONB,
    "result" JSONB,
    "error" JSONB,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "modelMode" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "apiType" TEXT,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theatre_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "theatre_students_externalId_key" ON "theatre_students"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "theatre_students_normalizedNickname_key" ON "theatre_students"("normalizedNickname");

-- CreateIndex
CREATE INDEX "theatre_students_updatedAt_idx" ON "theatre_students"("updatedAt");

-- CreateIndex
CREATE INDEX "theatre_students_lastSeenAt_idx" ON "theatre_students"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "theatre_voiceprints_studentId_key" ON "theatre_voiceprints"("studentId");

-- CreateIndex
CREATE INDEX "theatre_voiceprints_updatedAt_idx" ON "theatre_voiceprints"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "theatre_sessions_externalId_key" ON "theatre_sessions"("externalId");

-- CreateIndex
CREATE INDEX "theatre_sessions_studentId_updatedAt_idx" ON "theatre_sessions"("studentId", "updatedAt");

-- CreateIndex
CREATE INDEX "theatre_sessions_deviceId_updatedAt_idx" ON "theatre_sessions"("deviceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "theatre_sessions_studentId_deviceId_key" ON "theatre_sessions"("studentId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "theatre_tasks_diagnosticId_key" ON "theatre_tasks"("diagnosticId");

-- CreateIndex
CREATE INDEX "theatre_tasks_startedAt_idx" ON "theatre_tasks"("startedAt");

-- CreateIndex
CREATE INDEX "theatre_tasks_status_startedAt_idx" ON "theatre_tasks"("status", "startedAt");

-- CreateIndex
CREATE INDEX "theatre_tasks_userKey_startedAt_idx" ON "theatre_tasks"("userKey", "startedAt");

-- CreateIndex
CREATE INDEX "theatre_tasks_studentId_startedAt_idx" ON "theatre_tasks"("studentId", "startedAt");

-- CreateIndex
CREATE INDEX "theatre_tasks_deviceId_startedAt_idx" ON "theatre_tasks"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "theatre_tasks_interactionId_idx" ON "theatre_tasks"("interactionId");

-- CreateIndex
CREATE INDEX "theatre_tasks_clientTaskId_idx" ON "theatre_tasks"("clientTaskId");

-- AddForeignKey
ALTER TABLE "theatre_voiceprints" ADD CONSTRAINT "theatre_voiceprints_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "theatre_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theatre_sessions" ADD CONSTRAINT "theatre_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "theatre_students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
