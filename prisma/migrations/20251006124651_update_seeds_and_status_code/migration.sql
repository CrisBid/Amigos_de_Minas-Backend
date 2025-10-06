/*
  Warnings:

  - The values [ACTIVE] on the enum `SponsorshipStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."SponsorshipStatus_new" AS ENUM ('PENDING', 'COMPLETED', 'IN_PROGRESS', 'ENDED', 'CANCELLED');
ALTER TABLE "public"."Sponsorship" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."Sponsorship" ALTER COLUMN "status" TYPE "public"."SponsorshipStatus_new" USING ("status"::text::"public"."SponsorshipStatus_new");
ALTER TYPE "public"."SponsorshipStatus" RENAME TO "SponsorshipStatus_old";
ALTER TYPE "public"."SponsorshipStatus_new" RENAME TO "SponsorshipStatus";
DROP TYPE "public"."SponsorshipStatus_old";
ALTER TABLE "public"."Sponsorship" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;
