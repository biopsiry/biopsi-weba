import PdfViewer from '@/components/PdfViewer';
import { getDictionary } from '@/dictionaries';
import { toCalendarDate } from '@/libs/constants';
import { flipSanomatLocale } from '@/libs/strapi/flip-locale';
import { formatMetadata } from '@/libs/strapi/format-metadata';
import { getStrapiData } from '@/libs/strapi/get-strapi-data';
import { getStrapiUrl } from '@/libs/strapi/get-strapi-url';
import { APIResponseCollection } from '@/types/types';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { lang as language } from 'next/root-params';

const baseUrl =
  '/api/biopsi-sanomats?populate[0]=image&populate[1]=pdf&populate[2]=Seo.openGraph.openGraphImage&populate[3]=Seo.twitter.twitterImage&populate[4]=localizations&populate=localizations.Seo.twitter.twitterImage&populate=localizations.Seo.openGraph.openGraphImage&filters[publishedAt][$gte]=';

interface BiopsiSanomatProps {
  params: Promise<{ slug: string }>;
}

export const instant = false;

export default async function BiopsiSanomatPublication(
  props: BiopsiSanomatProps,
) {
  const lang = await language();
  const params = await props.params;
  const dictionary = await getDictionary();

  // If two entries are published within same date this blows up (sorry)
  const pageData = await getStrapiData<
    APIResponseCollection<'api::biopsi-sanomat.biopsi-sanomat'>
  >({
    lang: 'fi',
    url: `/api/biopsi-sanomats?${buildQuery(params.slug)}`,
    collection: 'biopsi-sanomat',
    ignoreError: true,
    unique: true,
  });

  if (!pageData?.data.length) {
    redirect(`/${lang}/404`);
  }

  const sanomatLocaleFlipped = flipSanomatLocale(lang, pageData.data);

  const selectedPublication = sanomatLocaleFlipped[0];

  return (
    <article className="relative flex flex-col gap-12">
      <h1>
        {dictionary.general.publication}{' '}
        {new Date(
          selectedPublication?.publishedAt || selectedPublication.createdAt!,
        )
          .toLocaleDateString(lang, {
            month: 'short',
            year: 'numeric',
          })
          .toLowerCase()}
      </h1>
      <div className="h-full overflow-x-hidden">
        <PdfViewer
          dictionary={dictionary}
          pdfUrl={getStrapiUrl(selectedPublication.pdf?.url)}
        />
      </div>
      <div className="luuppi-pattern absolute -left-48 -top-10 -z-50 h-[701px] w-[801px] max-md:left-0 max-md:h-full max-md:w-full max-md:rounded-none" />
    </article>
  );
}

export async function generateMetadata(
  props: BiopsiSanomatProps,
): Promise<Metadata> {
  const params = await props.params;
  const data = await getStrapiData<
    APIResponseCollection<'api::biopsi-sanomat.biopsi-sanomat'>
  >({
    lang: 'fi',
    url: `/api/biopsi-sanomats?${buildQuery(params.slug)}`,
    collection: 'biopsi-sanomat',
    unique: true,
  });
  const lang = await language();
  const sanomatLocaleFlipped = flipSanomatLocale(lang, data.data);
  const selectedPublication = sanomatLocaleFlipped[0];
  const pathname = `/${lang}/biopsi-sanomat/${params.slug}`;

  // No version of the content exists in the requested language
  if (!selectedPublication?.Seo?.id) {
    return {};
  }

  return formatMetadata({ data: selectedPublication }, pathname);
}

export async function generateStaticParams() {
  const pageData = await getStrapiData<
    APIResponseCollection<'api::biopsi-sanomat.biopsi-sanomat'>
  >({
    lang: 'fi',
    url: '/api/biopsi-sanomats?pagination[pageSize]=500',
    collection: 'biopsi-sanomat',
  });

  return pageData.data.map((sanomat) => ({
    slug: toCalendarDate(sanomat.publishedAt!),
  }));
}
