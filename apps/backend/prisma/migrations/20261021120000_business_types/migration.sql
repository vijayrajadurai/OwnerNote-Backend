-- What the business does (SERVICE / RETAIL / WHOLESALE); empty for a business set up before.
ALTER TABLE "Business" ADD COLUMN     "businessTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
