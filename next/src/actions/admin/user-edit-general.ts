'use server';
import { auth } from '@/auth';
import { getDictionary } from '@/dictionaries';
import prisma from '@/libs/db/prisma';
import { logger } from '@/libs/utils/logger';
import { SupportedLanguage } from '@/models/locale';
import { updateTag } from 'next/cache';

export async function userEditGeneral(
  formData: FormData,
  lang: SupportedLanguage,
  userToEditEntraUuid: string,
) {
  const dictionary = await getDictionary(lang);

  const session = await auth();
  const user = session?.user;

  if (!user || !user.isBiopsiHato) {
    logger.error('User not found in session');
    return {
      message: dictionary.api.unauthorized,
      isError: true,
    };
  }

  const hasHatoRole = await prisma.rolesOnUsers.findFirst({
    where: {
      entraUserUuid: user.entraUserUuid,
      strapiRoleUuid: process.env.NEXT_PUBLIC_BIOPSI_HATO_ID!,
      OR: [
        {
          expiresAt: {
            gte: new Date(),
          },
        },
        {
          expiresAt: null,
        },
      ],
    },
  });

  if (!hasHatoRole) {
    logger.error('User does not have the required role');
    return {
      message: dictionary.api.unauthorized,
      isError: true,
    };
  }

  const fields: Record<
    string,
    { value: FormDataEntryValue | null; regex: RegExp; required?: boolean }
  > = {
    username: {
      value: formData.get('username'),

      // Regex checks for:
      // - 3-30 characters
      // - No consecutive underscores or hyphens
      // - Only letters, numbers, underscores, hyphens, and Finnish/Swedish characters
      regex: /^(?!.*[-_]{2})[a-zA-Z0-9äÄöÖåÅ_-]{3,30}$/,
    },
    telegramUsername: {
      value: formData.get('telegramUsername')?.toString().trim().replace(/^@/, '') || null,
      regex: /^[a-zA-Z0-9_]{3,35}$/,
    },
    firstName: {
      value: formData.get('firstName'),
      regex: /^.{2,70}$/,
    },
    lastName: {
      value: formData.get('lastName'),
      regex: /^.{2,35}$/,
    },
    domicle: {
      value: formData.get('domicle'),
      regex: /^.{2,35}$/,
    },
    preferredFullName: {
      value: formData.get('preferredFullName'),
      regex: /^[a-zA-ZäÄöÖåÅ\-\s]{2,100}$/,
    },
    major: {
      value: formData.get('major'),
      regex: /^(COMPUTER_SCIENCE|MATHEMATICS|STATISTICAL_|OTHER)$/,
      required: true,
    },
  };

  const errors = Object.entries(fields)
    .map(([fieldName, { value, regex, required }]) =>
      validateField(
        value?.toString() ?? null,
        regex,
        dictionary,
        fieldName,
        required,
      ),
    )
    .filter((error) => error !== null);

  if (errors.length > 0) {
    return errors[0] as { message: string; isError: boolean; field: string };
  }

  const fieldsToUpdate = Object.fromEntries(
    Object.entries(fields).map(([fieldName, { value }]) => [
      fieldName,
      value ? value.toString() : null,
    ]),
  );

  await prisma.user.update({
    where: {
      entraUserUuid: userToEditEntraUuid,
    },
    data: {
      lastName: fieldsToUpdate.lastName,
      firstName: fieldsToUpdate.firstName,
      username: fieldsToUpdate.username,
      telegramUsername: fieldsToUpdate.telegramUsername,
      preferredFullName: fieldsToUpdate.preferredFullName,
      major:
        fieldsToUpdate.major === 'BIOTECHNOLOGY'
          ? 'BIOTECHNOLOGY'
            : 'OTHER',
      domicle: fieldsToUpdate.domicle,
    },
  });

  updateTag(`get-cached-user:${userToEditEntraUuid}`);

  return {
    message: dictionary.api.user_updated,
    isError: false,
  };
}

function validateField(
  fieldValue: string | null,
  regex: RegExp,
  dictionary: any,
  fieldName: string,
  required?: boolean,
) {
  const fieldNameSnakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();

  if (required && !fieldValue) {
    return {
      message: dictionary.api[`invalid_${fieldNameSnakeCase}`],
      isError: true,
      field: fieldName,
    };
  }

  if (fieldValue && !regex.test(fieldValue)) {
    return {
      message: dictionary.api[`invalid_${fieldNameSnakeCase}`],
      isError: true,
      field: fieldName,
    };
  }
  return null;
}
