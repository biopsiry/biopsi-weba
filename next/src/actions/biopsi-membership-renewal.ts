'use server';

import { auth } from '@/auth';
import prisma from '@/libs/db/prisma';
import { logger } from '@/libs/utils/logger';
import { redirect } from 'next/navigation';

export async function startBiopsiMembershipRenewal() {
  const session = await auth();

  if (!session?.user?.entraUserUuid) {
    throw new Error('Unauthorized');
  }

  const entraUserUuid = session.user.entraUserUuid;
  const biopsiRoleId = process.env.NEXT_PUBLIC_BIOPSI_MEMBER_ID;
  const paymentLinkUrl = process.env.STRIPE_BIOPSI_PAYMENT_LINK_URL;

  if (!biopsiRoleId) {
    throw new Error(
      'NEXT_PUBLIC_BIOPSI_MEMBER_ID is not configured',
    );
  }

  if (!paymentLinkUrl) {
    throw new Error(
      'STRIPE_BIOPSI_PAYMENT_LINK_URL is not configured',
    );
  }

  const localUser = await prisma.user.findFirst({
    where: {
      entraUserUuid,
    },
    select: {
      email: true,
    },
  });

  if (!localUser) {
    throw new Error('User not found');
  }

  const email = localUser.email ?? session.user.email;

  if (!email) {
    throw new Error(
      'User does not have an email address',
    );
  }

  const membership = await prisma.rolesOnUsers.findUnique({
    where: {
      strapiRoleUuid_entraUserUuid: {
        entraUserUuid,
        strapiRoleUuid: biopsiRoleId,
      },
    },
  });

  if (!membership) {
    throw new Error('Biopsi membership not found');
  }

  if (!membership.expiresAt) {
    throw new Error(
      'Biopsi membership does not expire',
    );
  }

  const now = new Date();
  const renewalOpensAt = addCalendarMonths(membership.expiresAt, -1);
  const renewalClosesAt = addCalendarMonths(membership.expiresAt, 2);

  if (now < renewalOpensAt || now > renewalClosesAt) {
    throw new Error(
      'Biopsi membership is outside the allowed renewal window',
    );
  }

  const orderId = `biopsi_${crypto.randomUUID()}`;
  const stripeUrl = new URL(paymentLinkUrl);

  await prisma.biopsiMembershipRenewal.create({
    data: {
      orderId,
      entraUserUuid,
    },
  });

  stripeUrl.searchParams.set(
    'client_reference_id',
    orderId,
  );

  stripeUrl.searchParams.set(
    'locked_prefilled_email',
    email,
  );

  logger.info(
    'Created Biopsi membership renewal',
    {
      orderId,
      entraUserUuid,
      email,
    },
  );

  redirect(stripeUrl.toString());
}

function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDayOfMonth));

  return result;
}
