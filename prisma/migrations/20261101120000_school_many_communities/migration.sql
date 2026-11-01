-- CreateTable
CREATE TABLE "public"."SchoolCommunity" (
    "schoolId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolCommunity_pkey" PRIMARY KEY ("schoolId","communityId")
);

-- CreateIndex
CREATE INDEX "SchoolCommunity_communityId_idx" ON "public"."SchoolCommunity"("communityId");

-- AddForeignKey
ALTER TABLE "public"."SchoolCommunity" ADD CONSTRAINT "SchoolCommunity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "public"."School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SchoolCommunity" ADD CONSTRAINT "SchoolCommunity_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "public"."Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados: o vínculo único que cada escola já tinha vira o primeiro da lista
INSERT INTO "public"."SchoolCommunity" ("schoolId", "communityId")
SELECT "id", "communityId" FROM "public"."School" WHERE "communityId" IS NOT NULL
ON CONFLICT DO NOTHING;
