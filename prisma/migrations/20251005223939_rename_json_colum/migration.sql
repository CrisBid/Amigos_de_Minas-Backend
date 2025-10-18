/*
  Warnings:

  - You are about to drop the column `composeConfig` on the `ChildImage` table. All the data in the column will be lost.
  - You are about to drop the column `frameConfig` on the `ChildImage` table. All the data in the column will be lost.
  - You are about to drop the `ChildCampaignMedia` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."ChildCampaignMedia" DROP CONSTRAINT "ChildCampaignMedia_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "public"."ChildCampaignMedia" DROP CONSTRAINT "ChildCampaignMedia_childId_fkey";

-- AlterTable
ALTER TABLE "public"."ChildImage" DROP COLUMN "composeConfig",
DROP COLUMN "frameConfig",
ADD COLUMN     "Config" JSONB;

-- DropTable
DROP TABLE "public"."ChildCampaignMedia";
