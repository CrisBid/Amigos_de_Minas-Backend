/*
  Warnings:

  - You are about to drop the `CampaignChildSource` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."CampaignChildSource" DROP CONSTRAINT "CampaignChildSource_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "public"."CampaignChildSource" DROP CONSTRAINT "CampaignChildSource_sourceCampaignId_fkey";

-- DropTable
DROP TABLE "public"."CampaignChildSource";

-- CreateTable
CREATE TABLE "public"."CampaignChildInclude" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "sourceCampaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignChildInclude_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignChildInclude_childId_idx" ON "public"."CampaignChildInclude"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignChildInclude_campaignId_childId_key" ON "public"."CampaignChildInclude"("campaignId", "childId");

-- AddForeignKey
ALTER TABLE "public"."CampaignChildInclude" ADD CONSTRAINT "CampaignChildInclude_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignChildInclude" ADD CONSTRAINT "CampaignChildInclude_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
