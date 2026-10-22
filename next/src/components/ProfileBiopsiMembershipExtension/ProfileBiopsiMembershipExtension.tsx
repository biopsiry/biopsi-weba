import { startBiopsiMembershipRenewal } from '@/actions/biopsi-membership-renewal';
import { Dictionary, SupportedLanguage } from '@/models/locale';
import Link from 'next/link';

interface ProfileBiopsiMembershipExtensionProps {
  dictionary: Dictionary;
  expiresAt: Date;
  lang: SupportedLanguage;
}

export default function ProfileBiopsiMembershipExtension({
  dictionary,
  expiresAt,
  lang,
}: ProfileBiopsiMembershipExtensionProps) {
  const now = new Date();
  const expired = expiresAt < now;
  const renewalOpensAt = addCalendarMonths(expiresAt, -2);
  const renewalClosesAt = addCalendarMonths(expiresAt, 2);
  const canRenew = now >= renewalOpensAt && now <= renewalClosesAt;
  const expiredTooLong = expired && !canRenew;

  return (
    <form
      action={startBiopsiMembershipRenewal}
      className="card card-body"
    >
      <h2 className="mb-4 text-lg font-semibold">
        {dictionary.pages_profile.biopsi_membership_extension_title}
      </h2>

      <p>
        {expired
          ? dictionary.pages_profile.biopsi_membership_expired_at
          : dictionary.pages_profile.biopsi_membership_expires_at}{' '}
        <strong>
          {new Intl.DateTimeFormat(lang, {
            month: 'long',
            year: 'numeric',
            day: 'numeric',
            timeZone: 'UTC',
          }).format(expiresAt)}{'.'}
        </strong>
      </p>

      <p>
        {expiredTooLong ? (
          <>
            {dictionary.pages_profile.biopsi_membership_expired_description}{' '}
            <Link className="link" href={`/${lang}/board`}>
              {dictionary.pages_profile.biopsi_membership_expired_description_link}
            </Link>
          </>
        ) : (
          dictionary.pages_profile.biopsi_membership_extension_description
        )}
      </p>

      <div>
        <button
          className="btn btn-primary"
          disabled={!canRenew}
          type="submit"
        >
          {dictionary.pages_profile.biopsi_membership_extension_button}
        </button>
      </div>
    </form>
  );
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