-- CreateTable
CREATE TABLE "public"."CampaignChildSource" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceCampaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignChildSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignChildSource_sourceCampaignId_idx" ON "public"."CampaignChildSource"("sourceCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignChildSource_campaignId_sourceCampaignId_key" ON "public"."CampaignChildSource"("campaignId", "sourceCampaignId");

-- AddForeignKey
ALTER TABLE "public"."CampaignChildSource" ADD CONSTRAINT "CampaignChildSource_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignChildSource" ADD CONSTRAINT "CampaignChildSource_sourceCampaignId_fkey" FOREIGN KEY ("sourceCampaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
