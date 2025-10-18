/*
  Warnings:

  - You are about to drop the column `city` on the `Child` table. All the data in the column will be lost.
  - You are about to drop the column `legacyCode` on the `Child` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `City` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[publicId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[publicId]` on the table `Child` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[publicId]` on the table `City` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cityName` to the `Child` table without a default value. This is not possible if the table is not empty.
  - Added the required column `publicId` to the `Child` table without a default value. This is not possible if the table is not empty.
  - Added the required column `publicId` to the `City` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."Child_legacyCode_key";

-- DropIndex
DROP INDEX "public"."City_name_key";

-- DropIndex
DROP INDEX "public"."City_slug_key";

-- AlterTable
ALTER TABLE "public"."Campaign" ADD COLUMN     "publicId" INTEGER;

-- AlterTable
ALTER TABLE "public"."Child" DROP COLUMN "city",
DROP COLUMN "legacyCode",
ADD COLUMN     "cityName" TEXT NOT NULL,
ADD COLUMN     "publicId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."City" DROP COLUMN "slug",
ADD COLUMN     "publicId" INTEGER NOT NULL,
ADD COLUMN     "state" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_publicId_key" ON "public"."Campaign"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Child_publicId_key" ON "public"."Child"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "City_publicId_key" ON "public"."City"("publicId");
