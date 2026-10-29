-- CreateTable
CREATE TABLE "public"."ChildCampaignGift" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "wantedGift" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildCampaignGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildCampaignGift_campaignId_idx" ON "public"."ChildCampaignGift"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "ChildCampaignGift_childId_campaignId_key" ON "public"."ChildCampaignGift"("childId", "campaignId");

-- AddForeignKey
ALTER TABLE "public"."ChildCampaignGift" ADD CONSTRAINT "ChildCampaignGift_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChildCampaignGift" ADD CONSTRAINT "ChildCampaignGift_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
