-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "frameConfig" JSONB,
ADD COLUMN     "frameKey" TEXT,
ADD COLUMN     "frameUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Child" ADD COLUMN     "photoKey" TEXT;

-- CreateTable
CREATE TABLE "public"."ChildCampaignMedia" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "originalKey" TEXT,
    "originalUrl" TEXT,
    "processedKey" TEXT,
    "processedUrl" TEXT,
    "framedKey" TEXT,
    "framedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildCampaignMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildCampaignMedia_campaignId_idx" ON "public"."ChildCampaignMedia"("campaignId");

-- CreateIndex
CREATE INDEX "ChildCampaignMedia_childId_idx" ON "public"."ChildCampaignMedia"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "ChildCampaignMedia_childId_campaignId_key" ON "public"."ChildCampaignMedia"("childId", "campaignId");

-- AddForeignKey
ALTER TABLE "public"."ChildCampaignMedia" ADD CONSTRAINT "ChildCampaignMedia_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChildCampaignMedia" ADD CONSTRAINT "ChildCampaignMedia_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
