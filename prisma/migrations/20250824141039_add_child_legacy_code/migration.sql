/*
  Warnings:

  - A unique constraint covering the columns `[legacyCode]` on the table `Child` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Child" ADD COLUMN     "legacyCode" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Child_legacyCode_key" ON "public"."Child"("legacyCode");
