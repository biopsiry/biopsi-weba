import ContentPage from '@/components/ContentPage/ContentPage';
import { formatMetadata } from '@/libs/strapi/format-metadata';
import { getStrapiData } from '@/libs/strapi/get-strapi-data';
import { APIResponse } from '@/types/types';
import { Metadata } from 'next';
import { lang as language } from 'next/root-params';

const url =
<<<<<<< HEAD:next/src/app/[lang]/(content-pages)/organization/overall-patches/page.tsx
  '/api/organization-overall-patch?populate[0]=Content.banner&populate[1]=Seo.twitter.twitterImage&populate[2]=Seo.openGraph.openGraphImage';
const tags = [
  'organization-overall-patch',
] as const satisfies StrapiCacheTag[];

export default async function OrganizationOverallPatches() {
  return <ContentPage fetchTags={tags} url={url} />;
=======
  '/api/organization-office-hervanta?populate[0]=Content.banner&populate[1]=Seo.twitter.twitterImage&populate[2]=Seo.openGraph.openGraphImage';

export default async function OrganizationOfficeHervanta() {
  return (
    <ContentPage collection="organization-office-hervanta" url={url} unique />
  );
>>>>>>> 5a9a47f8 (Refactor getStrapiData):next/src/app/[lang]/(content-pages)/organization/office-hervanta/page.tsx
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await language();
  const data = await getStrapiData<
<<<<<<< HEAD:next/src/app/[lang]/(content-pages)/organization/overall-patches/page.tsx
    APIResponse<'api::organization-overall-patch.organization-overall-patch'>
  >(lang, url, tags);
=======
    APIResponse<'api::organization-office-hervanta.organization-office-hervanta'>
  >({
    lang,
    url,
    collection: 'organization-office-hervanta',
    unique: true,
  });
>>>>>>> 5a9a47f8 (Refactor getStrapiData):next/src/app/[lang]/(content-pages)/organization/office-hervanta/page.tsx

  const pathname = `/${lang}/overall-patches`;

  return formatMetadata(data, pathname);
}
