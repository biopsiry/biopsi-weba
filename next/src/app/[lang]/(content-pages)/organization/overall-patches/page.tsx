import ContentPage from '@/components/ContentPage/ContentPage';
import { formatMetadata } from '@/libs/strapi/format-metadata';
import { getStrapiData } from '@/libs/strapi/get-strapi-data';
import { APIResponse } from '@/types/types';
import { Metadata } from 'next';
import { lang as language } from 'next/root-params';

const url =
  '/api/organization-overall-patch?populate[0]=Content.banner&populate[1]=Seo.twitter.twitterImage&populate[2]=Seo.openGraph.openGraphImage';

export default async function OrganizationOfficeHervanta() {
  return (
    <ContentPage collection="organization-overall-patch" url={url} unique />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await language();
  const data = await getStrapiData<
    APIResponse<'api::organization-overall-patch.organization-overall-patch'>
  >({
    lang,
    url,
    collection: 'organization-overall-patch',
    unique: true,
  });

  const pathname = `/${lang}/overall-patches`;

  return formatMetadata(data, pathname);
}
