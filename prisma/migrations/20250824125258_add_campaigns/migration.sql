/*
  Warnings:

  - A unique constraint covering the columns `[childId,campaignId]` on the table `Sponsorship` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `campaignId` to the `Sponsorship` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FINISHED', 'ARCHIVED');

-- DropIndex
DROP INDEX "public"."Sponsorship_status_idx";

-- AlterTable
ALTER TABLE "public"."Sponsorship" ADD COLUMN     "campaignId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "public"."Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "year" INTEGER,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "public"."CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "public"."Campaign"("slug");

-- CreateIndex
CREATE INDEX "Sponsorship_campaignId_idx" ON "public"."Sponsorship"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsorship_childId_campaignId_key" ON "public"."Sponsorship"("childId", "campaignId");

-- AddForeignKey
ALTER TABLE "public"."Sponsorship" ADD CONSTRAINT "Sponsorship_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
