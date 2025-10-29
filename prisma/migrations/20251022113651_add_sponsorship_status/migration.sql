-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."SponsorshipStatus" ADD VALUE 'IN_PURCHASE';
ALTER TYPE "public"."SponsorshipStatus" ADD VALUE 'PACKED';
ALTER TYPE "public"."SponsorshipStatus" ADD VALUE 'BOXED';
ALTER TYPE "public"."SponsorshipStatus" ADD VALUE 'AWAITING_DELIVERY';
