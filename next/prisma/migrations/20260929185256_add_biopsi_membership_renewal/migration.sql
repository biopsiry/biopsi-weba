-- AlterTable
ALTER TABLE "EventRegistration" ALTER COLUMN "reservedUntil" SET DEFAULT now() + interval '60 minutes';

-- CreateTable
CREATE TABLE "BiopsiMembershipRenewal" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "entraUserUuid" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "previousExpiresAt" TIMESTAMP(3),
    "newExpiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiopsiMembershipRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BiopsiMembershipRenewal_orderId_key" ON "BiopsiMembershipRenewal"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BiopsiMembershipRenewal_stripeCheckoutSessionId_key" ON "BiopsiMembershipRenewal"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "BiopsiMembershipRenewal_entraUserUuid_idx" ON "BiopsiMembershipRenewal"("entraUserUuid");
