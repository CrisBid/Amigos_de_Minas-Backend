/*
  Warnings:

  - You are about to drop the column `school` on the `Child` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Child" DROP COLUMN "school",
ADD COLUMN     "communityId" TEXT,
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "schoolLegacy" TEXT;

-- CreateTable
CREATE TABLE "public"."Community" (
    "id" TEXT NOT NULL,
    "publicId" INTEGER,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."School" (
    "id" TEXT NOT NULL,
    "publicId" INTEGER,
    "cityId" TEXT NOT NULL,
    "communityId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Community_publicId_key" ON "public"."Community"("publicId");

-- CreateIndex
CREATE INDEX "Community_cityId_name_idx" ON "public"."Community"("cityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Community_cityId_name_key" ON "public"."Community"("cityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "School_publicId_key" ON "public"."School"("publicId");

-- CreateIndex
CREATE INDEX "School_cityId_communityId_name_idx" ON "public"."School"("cityId", "communityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "School_cityId_name_key" ON "public"."School"("cityId", "name");

-- CreateIndex
CREATE INDEX "Child_cityId_communityId_schoolId_idx" ON "public"."Child"("cityId", "communityId", "schoolId");

-- CreateIndex
CREATE INDEX "City_name_state_idx" ON "public"."City"("name", "state");

-- AddForeignKey
ALTER TABLE "public"."Community" ADD CONSTRAINT "Community_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "public"."City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."School" ADD CONSTRAINT "School_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "public"."City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."School" ADD CONSTRAINT "School_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "public"."Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Child" ADD CONSTRAINT "Child_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "public"."Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Child" ADD CONSTRAINT "Child_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "public"."School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
