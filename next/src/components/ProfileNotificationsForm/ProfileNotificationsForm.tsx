'use client';

import { updateProfileNotifications } from '@/actions/tuni-mailman';
import { Dictionary } from '@/models/locale';
import { useState } from 'react';
import FormCheckbox from '../FormCheckbox/FormCheckbox';

interface ProfileNotificationsFormProps {
  dictionary: Dictionary;
  subscribed: boolean;
  available: boolean;
}

export default function ProfileNotificationsForm({
  dictionary,
  subscribed,
  available,
}: ProfileNotificationsFormProps) {
  const [isSubscribed, setIsSubscribed] = useState(subscribed);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleToggle = async (nextSubscribed: boolean) => {
    if (!available || isPending) {
      return;
    }

    const previousSubscribed = isSubscribed;

    setIsPending(true);
    setMessage(null);

    // Optimistic update.
    setIsSubscribed(nextSubscribed);

    try {
      const result =
        await updateProfileNotifications(nextSubscribed);

      if (!result.success) {
        setIsSubscribed(result.subscribed);

        setMessage({
          text: result.error,
          isError: true,
        });

        return;
      }

      setIsSubscribed(result.subscribed);

      setMessage({
        text: nextSubscribed
          ? dictionary.mail_list.subscribed
          : dictionary.mail_list.unsubscribed,
        isError: false,
      });
    } catch {
      setIsSubscribed(previousSubscribed);

      setMessage({
        text: dictionary.mail_list.subscription_error,
        isError: true,
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      className="card card-body"
      onSubmit={(event) => event.preventDefault()}
    >
      <h2 className="mb-4 text-lg font-semibold">
        {dictionary.pages_profile.email_subscription}
      </h2>
      <FormCheckbox
        checked={isSubscribed}
        disabled={!available || isPending}
        id="biopsilaiset"
        title={dictionary.mail_list.loop}
        onChange={(e) => handleToggle(e.target.checked)}
      />

      {!available && (
        <div className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">
          Mailing list service is currently unavailable.
        </div>
      )}

      {message && (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            message.isError
              ? 'bg-error/10 text-error'
              : 'bg-success/10 text-success'
          }`}
        >
          {message.text}
        </div>
      )}
    </form>
  );
}