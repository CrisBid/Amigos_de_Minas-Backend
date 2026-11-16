-- AlterTable: origem dos dados da campanha (planilha e pasta de fotos no Google)
ALTER TABLE "public"."Campaign" ADD COLUMN "sourceSheetId" TEXT;
ALTER TABLE "public"."Campaign" ADD COLUMN "sourcePhotosFolderId" TEXT;
