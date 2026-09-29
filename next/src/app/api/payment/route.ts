import prisma from '@/libs/db/prisma';
import { sendEventReceiptEmail } from '@/libs/emails/send-event-verify';
import { checkBiopsiStripeReturn } from '@/libs/payments/check-biopsi-stripe-return';
import { checkReturn } from '@/libs/payments/check-return';
import { getStrapiData } from '@/libs/strapi/get-strapi-data';
import { logger } from '@/libs/utils/logger';
import { completeBiopsiMembershipRenewal } from '@/libs/utils/membership';
import { APIResponse } from '@/types/types';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const biopsiResult = await checkBiopsiStripeReturn(
      request.clone(),
    );

    if (biopsiResult) {
      const { orderId, status, stripeCheckoutSessionId } = biopsiResult;

      if (!orderId) {
        logger.error(`Biopsi Stripe Checkout Session ${stripeCheckoutSessionId} has no client_reference_id`);

        return NextResponse.json({ message: 'OK' }, { status: 200 });
      }

      const renewal =
        await prisma.biopsiMembershipRenewal.findUnique({
          where: {
            orderId,
          },
        });

      if (!renewal) {
        logger.error(`Biopsi renewal not found for Stripe order ${orderId}`);
        return NextResponse.json({ message: 'OK' }, { status: 200 });
      }

      if (status === 'PENDING') {
        logger.info('Biopsi Stripe payment is pending', { orderId, stripeCheckoutSessionId });
        return NextResponse.json({ message: 'OK' }, { status: 200 });
      }

      if (status === 'FAILED') {
        await prisma.biopsiMembershipRenewal.updateMany({
          where: {
            orderId,
            completedAt: null,
          },
          data: {
            cancelledAt: new Date(),
          },
        });

        logger.info('Biopsi membership payment failed or expired', {
          orderId,
          stripeCheckoutSessionId,
        });

        return NextResponse.json({ message: 'OK' }, { status: 200 });
      }

      const completedRenewal =
        await completeBiopsiMembershipRenewal({
          orderId,
          stripeCheckoutSessionId,
        });

      logger.info('Biopsi membership renewed successfully', {
        orderId,
        entraUserUuid: renewal.entraUserUuid,
        previousExpiresAt: completedRenewal.previousExpiresAt,
        newExpiresAt: completedRenewal.newExpiresAt,
      });

      return NextResponse.json({ message: 'OK' }, { status: 200 });
    }

    const result = await checkReturn(request);

    if (!result) {
      return NextResponse.json(
        { message: 'Error processing payment webhook' },
        { status: 200 },
      );
    }

    const { orderId, successful, status } = result;
    logger.info('Processing payment webhook', { orderId, successful, status });

    const payment = await prisma.payment.update({
      where: { orderId },
      data: {
        status: successful ? 'COMPLETED' : 'CANCELLED',
        registration: {
          updateMany: successful
            ? {
                where: {},
                data: {
                  paymentCompleted: successful,
                },
              }
            : undefined,
        },
      },
      include: {
        registration: {
          include: {
            event: true,
          },
        },
      },
    });

    if (!successful) {
      return NextResponse.json({ message: 'OK' }, { status: 200 });
    }

    if (!payment.registration?.[0]?.entraUserUuid) {
      logger.error('Error getting entraUserUuid');
      return NextResponse.json(
        { message: 'Error getting entraUserUuid' },
        { status: 400 },
      );
    }

    const entraUserUuid = payment.registration[0].entraUserUuid;

    if (!entraUserUuid) {
      logger.error('Error getting entraUserUuid');
      return NextResponse.json(
        { message: 'Error getting entraUserUuid' },
        { status: 400 },
      );
    }

    const localUser = await prisma.user.findFirst({
      where: {
        entraUserUuid,
      },
    });

    if (!localUser) {
      logger.error('Error getting user');
      return NextResponse.json(
        { message: 'Error getting user' },
        { status: 400 },
      );
    }

    const eventDocumentId = payment.registration?.[0]?.event?.eventDocumentId;
    const strapiUrl = `/api/events/${eventDocumentId}?populate=Registration.RoleToGive`;
    const strapiEvents = await getStrapiData<APIResponse<'api::event.event'>>(
      'fi', // Does not matter here. We only need the role to give.
      strapiUrl,
      [`event-${eventDocumentId}`],
      true,
    );

    const strapiEvent = strapiEvents?.data;

    const roleToGive = strapiEvent?.Registration?.RoleToGive?.RoleId;

    const illegalRoles = [
      process.env.NEXT_PUBLIC_BIOPSI_HATO_ID!,
      process.env.NEXT_PUBLIC_NO_ROLE_ID!,
    ];

    if (roleToGive && !illegalRoles.includes(roleToGive)) {
      logger.info(
        `Event ${eventDocumentId} has role to give ${roleToGive}. Giving role to user ${entraUserUuid}`,
      );

      await prisma.rolesOnUsers.upsert({
        where: {
          strapiRoleUuid_entraUserUuid: {
            entraUserUuid,
            strapiRoleUuid: roleToGive,
          },
        },
        update: {},
        create: {
          entraUserUuid,
          strapiRoleUuid: roleToGive,
        },
      });
    }

    const name = localUser.username ?? localUser.firstName ?? '';
    const email = localUser.email;

    if (!email) {
      logger.error('Error getting email');
      return NextResponse.json(
        { message: 'Error getting email' },
        { status: 400 },
      );
    }

    if (!payment.confirmationSentAt && successful) {
      const emailMessageId = await sendEventReceiptEmail({
        name,
        email,
        payment,
      });

      if (!emailMessageId) {
        logger.error('Error sending email');
        return NextResponse.json(
          { message: 'Error sending email' },
          { status: 400 },
        );
      }

      await prisma.payment.update({
        where: {
          orderId,
        },
        data: {
          confirmationSentAt: new Date(),
        },
      });

      logger.info(`Event confirmation email sent: ${emailMessageId}`);
    }
  } catch (error) {
    logger.error('Error processing payment webhook', error);
    return NextResponse.json(
      { message: 'Error processing payment webhook' },
      { status: 400 },
    );
  }

  return NextResponse.json({ message: 'OK' }, { status: 200 });
}
