import { auth } from '@/auth';
import ProfileBiopsiMembershipExtension from '@/components/ProfileBiopsiMembershipExtension/ProfileBiopsiMembershipExtension';
import ProfileEmailform from '@/components/ProfileEmailForm/ProfileEmailForm';
import ProfileNotificationsForm from '@/components/ProfileNotificationsForm/ProfileNotificationsForm';
import ProfileUserInfoForm from '@/components/ProfileUserInfoForm/ProfileUserInfoForm';
import { getDictionary } from '@/dictionaries';
import prisma from '@/libs/db/prisma';
import { logger } from '@/libs/utils/logger';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { lang as language } from 'next/root-params';

const mailman = {
  auth:
    'Basic ' +
    Buffer.from(
      `${process.env.MAILMAN_USER}:${process.env.MAILMAN_PASSWORD}`,
    ).toString('base64'),
  baseUrl: `http://${process.env.MAILMAN_HOSTNAME}:${process.env.MAILMAN_PORT}`,
};

export default async function Profile() {
  const lang = await language();
  const dictionary = await getDictionary();

  const session = await auth();
  if (!session?.user?.entraUserUuid) {
    logger.error('Error getting user');
    redirect(`/${lang}`);
  }

  const biopsiRoleId = process.env.NEXT_PUBLIC_BIOPSI_MEMBER_ID;
  if (!biopsiRoleId) {
    throw new Error('NEXT_PUBLIC_BIOPSI_MEMBER_ID is not configured');
  }

  const now = new Date();

  const subscribed = await fetch(
    `${mailman.baseUrl}/3.1/members/find?subscriber=${session.user.email}&list_id=loop.luuppi.fi`,
    {
      method: 'GET',
      headers: {
        Authorization: mailman.auth,
      },
    },
  )
    .then(async (res) => {
      if (!res.ok) return false;
      const data = await res.json();
      return data?.total_size > 0;
    })
    .catch(() => false);

  const localUser = await prisma.user.findFirst({
    where: {
      entraUserUuid: session.user.entraUserUuid,
    },
    include: {
      roles: {
        include: {
          role: true,
        },
        where: {
          OR: [
            {
              expiresAt: {
                gte: now,
              },
            },
            {
              expiresAt: null,
            },
          ],
        },
      },
    },
  });

  if (!localUser) {
    logger.error('User not found in database. This should not happen.');
    redirect(`/${lang}/404`);
  }

  const biopsiMembership = await prisma.rolesOnUsers.findUnique({
    where: {
      strapiRoleUuid_entraUserUuid: {
        entraUserUuid: session.user.entraUserUuid,
        strapiRoleUuid: biopsiRoleId,
      },
    },
  });

  const isBiopsiMember = Boolean(biopsiMembership && (biopsiMembership.expiresAt === null || biopsiMembership.expiresAt >= now));
  const showBiopsiMembershipRenewal = Boolean(biopsiMembership?.expiresAt);

  return (
    <div className="relative">
      <h1 className="mb-12">{dictionary.navigation.profile}</h1>
      <div className="flex w-full flex-col gap-8">
        <ProfileEmailform
          dictionary={dictionary}
          lang={lang}
          user={localUser}
        />
        <ProfileUserInfoForm
          dictionary={dictionary}
          isBiopsiMember={isBiopsiMember}
          lang={lang}
          user={localUser}
        />
        {showBiopsiMembershipRenewal && biopsiMembership?.expiresAt && (
          <ProfileBiopsiMembershipExtension
            dictionary={dictionary}
            expiresAt={biopsiMembership.expiresAt}
            lang={lang}
          />
        )}
        <ProfileNotificationsForm
          dictionary={dictionary}
          subscribed={subscribed}
        />
      </div>
      <div className="luuppi-pattern absolute -left-48 -top-10 -z-50 h-[701px] w-[801px] max-md:left-0 max-md:h-full max-md:w-full max-md:rounded-none" />
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const dictionary = await getDictionary();
  return {
    title: dictionary.navigation.profile,
  };
}
