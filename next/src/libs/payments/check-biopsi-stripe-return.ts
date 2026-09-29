import { getStripe } from '@/libs/payments/stripe';
import Stripe from 'stripe';

export type BiopsiStripePaymentStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'PENDING';

export interface BiopsiStripeReturn {
  orderId: string | null;
  status: BiopsiStripePaymentStatus;
  stripeCheckoutSessionId: string;
}

export async function checkBiopsiStripeReturn(
  request: Request,
): Promise<BiopsiStripeReturn | null> {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return null;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  const expectedPaymentLinkId =
    process.env.STRIPE_BIOPSI_PAYMENT_LINK_ID;

  if (!expectedPaymentLinkId) {
    throw new Error(
      'STRIPE_BIOPSI_PAYMENT_LINK_ID is not configured',
    );
  }

  const body = await request.text();

  const stripe = getStripe();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
  } catch (error) {
    throw new Error(
      `Invalid Stripe webhook signature: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded' &&
    event.type !== 'checkout.session.async_payment_failed' &&
    event.type !== 'checkout.session.expired'
  ) {
    return null;
  }

  const checkoutSession =
    event.data.object as Stripe.Checkout.Session;

  const paymentLinkId =
    typeof checkoutSession.payment_link === 'string'
      ? checkoutSession.payment_link
      : checkoutSession.payment_link?.id;

  if (paymentLinkId !== expectedPaymentLinkId) {
    return null;
  }

  let status: BiopsiStripePaymentStatus;

  switch (event.type) {
    case 'checkout.session.async_payment_succeeded':
      status = 'SUCCESS';
      break;

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      status = 'FAILED';
      break;

    case 'checkout.session.completed':
      status =
        checkoutSession.payment_status === 'paid'
          ? 'SUCCESS'
          : 'PENDING';
      break;
  }

  return {
    orderId: checkoutSession.client_reference_id,
    status,
    stripeCheckoutSessionId: checkoutSession.id,
  };
}