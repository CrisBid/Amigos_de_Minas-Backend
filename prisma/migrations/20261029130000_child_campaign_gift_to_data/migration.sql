-- ChildCampaignGift passa a guardar também o ID da criança em cada campanha.
-- Renomeia (em vez de recriar) para preservar os presentes já gravados.

-- RenameTable
ALTER TABLE "public"."ChildCampaignGift" RENAME TO "ChildCampaignData";

-- RenamePrimaryKey
ALTER TABLE "public"."ChildCampaignData" RENAME CONSTRAINT "ChildCampaignGift_pkey" TO "ChildCampaignData_pkey";

-- RenameForeignKey
ALTER TABLE "public"."ChildCampaignData" RENAME CONSTRAINT "ChildCampaignGift_childId_fkey" TO "ChildCampaignData_childId_fkey";

-- RenameForeignKey
ALTER TABLE "public"."ChildCampaignData" RENAME CONSTRAINT "ChildCampaignGift_campaignId_fkey" TO "ChildCampaignData_campaignId_fkey";

-- RenameIndex
ALTER INDEX "public"."ChildCampaignGift_childId_campaignId_key" RENAME TO "ChildCampaignData_childId_campaignId_key";

-- DropIndex (coberto pelo índice único campaignId+publicId abaixo)
DROP INDEX "public"."ChildCampaignGift_campaignId_idx";

-- AlterTable
ALTER TABLE "public"."ChildCampaignData" ADD COLUMN "publicId" INTEGER,
ALTER COLUMN "wantedGift" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ChildCampaignData_campaignId_publicId_key" ON "public"."ChildCampaignData"("campaignId", "publicId");
