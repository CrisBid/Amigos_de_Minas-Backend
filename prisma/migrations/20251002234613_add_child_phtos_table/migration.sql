-- CreateEnum
CREATE TYPE "public"."ChildImageStatus" AS ENUM ('ORIGINAL_UPLOADED', 'PROCESSED', 'COMPOSED', 'ERROR');

-- CreateTable
CREATE TABLE "public"."ChildImage" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "campaignId" TEXT,
    "originalKey" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "processedKey" TEXT,
    "processedUrl" TEXT,
    "framedKey" TEXT,
    "framedUrl" TEXT,
    "layoutKey" TEXT,
    "layoutUrl" TEXT,
    "composeConfig" JSONB,
    "frameConfig" JSONB,
    "width" INTEGER,
    "height" INTEGER,
    "status" "public"."ChildImageStatus" NOT NULL DEFAULT 'ORIGINAL_UPLOADED',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChildImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChildImage_childId_campaignId_idx" ON "public"."ChildImage"("childId", "campaignId");

-- AddForeignKey
ALTER TABLE "public"."ChildImage" ADD CONSTRAINT "ChildImage_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChildImage" ADD CONSTRAINT "ChildImage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
