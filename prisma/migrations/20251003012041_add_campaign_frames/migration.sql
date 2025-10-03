-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "activeFrameId" TEXT;

-- CreateTable
CREATE TABLE "public"."CampaignFrame" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "name" TEXT,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignFrame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignFrame_campaignId_active_idx" ON "public"."CampaignFrame"("campaignId", "active");

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_activeFrameId_fkey" FOREIGN KEY ("activeFrameId") REFERENCES "public"."CampaignFrame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignFrame" ADD CONSTRAINT "CampaignFrame_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
