-- CreateEnum
CREATE TYPE "public"."SponsorshipMethod" AS ENUM ('GIFT', 'PIX');

-- AlterTable
ALTER TABLE "public"."Sponsorship" ADD COLUMN     "donationAmount" DECIMAL(10,2),
ADD COLUMN     "method" "public"."SponsorshipMethod" NOT NULL DEFAULT 'GIFT',
ADD COLUMN     "pixPaidAt" TIMESTAMP(3),
ADD COLUMN     "pixTxid" TEXT;

-- CreateIndex
CREATE INDEX "Sponsorship_status_idx" ON "public"."Sponsorship"("status");

-- CreateIndex
CREATE INDEX "Sponsorship_method_idx" ON "public"."Sponsorship"("method");
