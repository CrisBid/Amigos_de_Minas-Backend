-- AlterTable
ALTER TABLE "public"."Sponsorship" ADD COLUMN     "collectionPointId" TEXT;

-- CreateTable
CREATE TABLE "public"."CollectionPoint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "district" TEXT,
    "cityName" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "responsibleUserId" TEXT,
    "phone" TEXT,
    "openingJson" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPoint_slug_key" ON "public"."CollectionPoint"("slug");

-- CreateIndex
CREATE INDEX "CollectionPoint_active_idx" ON "public"."CollectionPoint"("active");

-- CreateIndex
CREATE INDEX "CollectionPoint_cityName_state_idx" ON "public"."CollectionPoint"("cityName", "state");

-- CreateIndex
CREATE INDEX "CollectionPoint_responsibleUserId_idx" ON "public"."CollectionPoint"("responsibleUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPoint_name_cityName_state_key" ON "public"."CollectionPoint"("name", "cityName", "state");

-- CreateIndex
CREATE INDEX "Sponsorship_collectionPointId_idx" ON "public"."Sponsorship"("collectionPointId");

-- AddForeignKey
ALTER TABLE "public"."CollectionPoint" ADD CONSTRAINT "CollectionPoint_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Sponsorship" ADD CONSTRAINT "Sponsorship_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "public"."CollectionPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
