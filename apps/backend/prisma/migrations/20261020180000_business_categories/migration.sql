-- Several product business categories per business, and the owner's own name for "Other Product Businesses".
-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "otherCategoryName" TEXT;
