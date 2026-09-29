import prisma from '@/libs/db/prisma';

interface CompleteBiopsiMembershipRenewalParams {
  orderId: string;
  stripeCheckoutSessionId: string;
}

export async function completeBiopsiMembershipRenewal({
  orderId,
  stripeCheckoutSessionId,
}: CompleteBiopsiMembershipRenewalParams) {
  const biopsiRoleId = process.env.NEXT_PUBLIC_BIOPSI_MEMBER_ID;

  if (!biopsiRoleId) {
    throw new Error(
      'NEXT_PUBLIC_BIOPSI_MEMBER_ID is not configured',
    );
  }

  return prisma.$transaction(async (tx) => {
    const renewal = await tx.biopsiMembershipRenewal.findUnique({
      where: {
        orderId,
      },
    });

    if (!renewal) {
      throw new Error(
        `Biopsi membership renewal not found for order ${orderId}`,
      );
    }

    if (renewal.completedAt) {
      return renewal;
    }

    const membership = await tx.rolesOnUsers.findUnique({
      where: {
        strapiRoleUuid_entraUserUuid: {
          entraUserUuid: renewal.entraUserUuid,
          strapiRoleUuid: biopsiRoleId,
        },
      },
    });

    if (!membership) {
      throw new Error(
        `Biopsi membership not found for user ${renewal.entraUserUuid}`,
      );
    }

    if (!membership.expiresAt) {
      throw new Error(
        'Biopsi membership does not have an expiration date',
      );
    }

    const now = new Date();
    const previousExpiresAt = membership.expiresAt;
    const extensionBase = previousExpiresAt > now ? previousExpiresAt : now;
    const newExpiresAt = addCalendarYear(extensionBase);
    const updateResult = await tx.rolesOnUsers.updateMany({
      where: {
        entraUserUuid: renewal.entraUserUuid,
        strapiRoleUuid: biopsiRoleId,
        expiresAt: previousExpiresAt,
      },
      data: {
        expiresAt: newExpiresAt,
      },
    });

    if (updateResult.count !== 1) {
      throw new Error(
        `Expected to update one Biopsi membership, updated ${updateResult.count}`,
      );
    }

    return tx.biopsiMembershipRenewal.update({
      where: {
        id: renewal.id,
      },
      data: {
        stripeCheckoutSessionId,
        previousExpiresAt,
        newExpiresAt,
        completedAt: now,
        cancelledAt: null,
      },
    });
  });
}

function addCalendarYear(date: Date): Date {
  const result = new Date(date);

  const originalMonth = result.getMonth();

  result.setFullYear(result.getFullYear() + 1);

  if (result.getMonth() !== originalMonth) {
    result.setDate(0);
  }

  return result;
}
