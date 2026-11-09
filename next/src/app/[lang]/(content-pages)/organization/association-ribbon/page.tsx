import ContentPage from '@/components/ContentPage/ContentPage';
import { formatMetadata } from '@/libs/strapi/format-metadata';
import { getStrapiData } from '@/libs/strapi/get-strapi-data';
import { APIResponse } from '@/types/types';
import { Metadata } from 'next';
import { lang as language } from 'next/root-params';

const url =
  '/api/organization-association-ribbon?populate[0]=Content.banner&populate[1]=Seo.twitter.twitterImage&populate[2]=Seo.openGraph.openGraphImage';

export default async function OrganizationAlumni() {
  return <ContentPage collection="organization-association-ribbon" url={url} unique />;
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await language();
  const data = await getStrapiData<
    APIResponse<'api::organization-association-ribbon.organization-association-ribbon'>
  >({ lang, url, collection: 'organization-association-ribbon', unique: true });

  const pathname = `/${lang}/organization/association-ribbon`;

  return formatMetadata(data, pathname);
}
