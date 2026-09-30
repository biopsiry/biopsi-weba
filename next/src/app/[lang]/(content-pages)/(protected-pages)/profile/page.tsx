import { auth } from '@/auth';
import ProfileBiopsiMembershipExtension from '@/components/ProfileBiopsiMembershipExtension/ProfileBiopsiMembershipExtension';
import ProfileEmailform from '@/components/ProfileEmailForm/ProfileEmailForm';
import ProfileNotificationsForm from '@/components/ProfileNotificationsForm/ProfileNotificationsForm';
import ProfileUserInfoForm from '@/components/ProfileUserInfoForm/ProfileUserInfoForm';
import { getDictionary } from '@/dictionaries';
import prisma from '@/libs/db/prisma';
import { tuniMailman } from '@/libs/mailman/tuni-mailman';
import { logger } from '@/libs/utils/logger';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { lang as language } from 'next/root-params';

export default async function Profile() {
  const lang = await language();
  const dictionary = await getDictionary();

  const session = await auth();
  if (!session?.user?.entraUserUuid) {
    logger.error('Error getting user');
    redirect(`/${lang}`);
  }

  if (!session?.user?.email) {
    logger.error('Error getting user email');
    redirect(`/${lang}`);
  }

  const biopsiRoleId = process.env.NEXT_PUBLIC_BIOPSI_MEMBER_ID;
  if (!biopsiRoleId) {
    throw new Error('NEXT_PUBLIC_BIOPSI_MEMBER_ID is not configured');
  }

  const now = new Date();

  const [
    localUser,
    biopsiMembership,
    mailmanState,
  ] = await Promise.all([
    prisma.user.findFirst({
      where: {
        entraUserUuid:
          session.user.entraUserUuid,
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
    }),

    prisma.rolesOnUsers.findUnique({
      where: {
        strapiRoleUuid_entraUserUuid: {
          entraUserUuid:
            session.user.entraUserUuid,
          strapiRoleUuid: biopsiRoleId,
        },
      },
    }),

    tuniMailman
      .isMember(session.user.email)
      .then((subscribed) => ({
        available: true,
        subscribed,
      }))
      .catch((error) => {
        logger.error(
          error instanceof Error
            ? `Unable to query TUNI Mailman: ${error.message}`
            : 'Unable to query TUNI Mailman',
        );

        return {
          available: false,
          subscribed: false,
        };
      }),
  ]);

  if (!localUser) {
    logger.error('User not found in database. This should not happen.');
    redirect(`/${lang}/404`);
  }

  const isBiopsiMember = Boolean(
    biopsiMembership &&
      (
        biopsiMembership.expiresAt === null ||
        biopsiMembership.expiresAt >= now
      ),
  );

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
        {biopsiMembership?.expiresAt && (
          <ProfileBiopsiMembershipExtension
            dictionary={dictionary}
            expiresAt={biopsiMembership.expiresAt}
            lang={lang}
          />
        )}
        {isBiopsiMember && (
          <ProfileNotificationsForm
            available={mailmanState.available}
            dictionary={dictionary}
            subscribed={mailmanState.subscribed}
          />
        )}
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
