'use server';

import { auth } from '@/auth';
import { tuniMailman } from '@/libs/mailman/tuni-mailman';
import { logger } from '@/libs/utils/logger';
import { revalidatePath } from 'next/cache';

export type NotificationSubscriptionResult =
  | {
      success: true;
      subscribed: boolean;
    }
  | {
      success: false;
      subscribed: boolean;
      error: string;
    };

export async function updateProfileNotifications(
  subscribed: boolean,
): Promise<NotificationSubscriptionResult> {
  const session = await auth();

  /*
   * IMPORTANT:
   *
   * Never accept the email address from the browser.
   * The authenticated session determines which address
   * may be modified.
   */
  const email = session?.user?.email;

  if (!email) {
    return {
      success: false,
      subscribed: false,
      error: 'You are not authenticated.',
    };
  }

  try {
    if (subscribed) {
      await tuniMailman.subscribe(email);
    } else {
      await tuniMailman.unsubscribe(email);
    }

    revalidatePath('/[lang]/profile', 'page');

    return {
      success: true,
      subscribed,
    };
  } catch (error) {
    logger.error(
      error instanceof Error
        ? `TUNI Mailman error: ${error.message}`
        : 'Unknown TUNI Mailman error',
    );

    try {
      const current =
        await tuniMailman.isMember(email);

      return {
        success: false,
        subscribed: current,
        error:
          'Unable to update mailing list subscription.',
      };
    } catch {
      return {
        success: false,
        subscribed: !subscribed,
        error:
          'Mailing list service is currently unavailable.',
      };
    }
  }
}