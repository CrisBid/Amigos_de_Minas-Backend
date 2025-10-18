-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('ADMIN', 'STAFF', 'SPONSOR');

-- CreateEnum
CREATE TYPE "public"."SponsorshipStatus" AS ENUM ('PENDING', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "public"."Role"[] DEFAULT ARRAY['SPONSOR']::"public"."Role"[],
    "refreshHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Child" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "age" INTEGER,
    "city" TEXT NOT NULL,
    "school" TEXT,
    "category" TEXT,
    "wantedGift" TEXT,
    "photoUrl" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Sponsorship" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "status" "public"."SponsorshipStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsorship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "Sponsorship_childId_idx" ON "public"."Sponsorship"("childId");

-- CreateIndex
CREATE INDEX "Sponsorship_sponsorId_idx" ON "public"."Sponsorship"("sponsorId");

-- CreateIndex
CREATE INDEX "Sponsorship_status_idx" ON "public"."Sponsorship"("status");

-- AddForeignKey
ALTER TABLE "public"."Sponsorship" ADD CONSTRAINT "Sponsorship_childId_fkey" FOREIGN KEY ("childId") REFERENCES "public"."Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Sponsorship" ADD CONSTRAINT "Sponsorship_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
