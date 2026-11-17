-- Histórico de alterações (auditoria)
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "campaignId" TEXT,
    "batchId" TEXT,
    "source" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "revertedAt" TIMESTAMP(3),
    "revertedBy" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "public"."AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_batchId_idx" ON "public"."AuditLog"("batchId");
CREATE INDEX "AuditLog_campaignId_createdAt_idx" ON "public"."AuditLog"("campaignId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "public"."AuditLog"("actorId", "createdAt");
