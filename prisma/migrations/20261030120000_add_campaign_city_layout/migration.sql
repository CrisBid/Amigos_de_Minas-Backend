-- CreateTable
CREATE TABLE "public"."CampaignCityLayout" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "frameId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignCityLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignCityLayout_frameId_idx" ON "public"."CampaignCityLayout"("frameId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignCityLayout_campaignId_cityId_key" ON "public"."CampaignCityLayout"("campaignId", "cityId");

-- AddForeignKey
ALTER TABLE "public"."CampaignCityLayout" ADD CONSTRAINT "CampaignCityLayout_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignCityLayout" ADD CONSTRAINT "CampaignCityLayout_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "public"."City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignCityLayout" ADD CONSTRAINT "CampaignCityLayout_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "public"."CampaignFrame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
