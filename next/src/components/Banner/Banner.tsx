import { SupportedLanguage } from '@/models/locale';
import Image from 'next/image';
import binarySvg from '../../../public/binary.svg';
import biopsiBannerTextEn from '../../../public/biopsi_banner_text_en.svg';
import biopsiBannerTextFi from '../../../public/biopsi_banner_text_fi.svg';

interface BannerProps {
  lang: SupportedLanguage;
}

export default function Banner({ lang }: BannerProps) {
  return (
    <section>
      <div className="h-72 bg-secondary-400 transition-all duration-300 max-md:h-48">
        <div className="relative flex h-full w-full justify-center overflow-hidden">
          <video
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
            preload="auto"
            autoPlay
            loop
            muted
            playsInline
          >
            <source src="https://biopsi.fi/biopsi_helix.mp4" type="video/mp4" />
          </video>

          <div className="relative z-10 flex h-full w-full max-md:h-48">
            <Image
              alt="Biopsi banner text"
              className="z-20 object-contain p-6 drop-shadow-[-6px_6px_#00000030] filter max-lg:drop-shadow-[-4px_4px_#00000030] max-md:p-4"
              draggable={false}
              src={lang === 'en' ? biopsiBannerTextEn : biopsiBannerTextFi}
              fill
              preload
            />

            <Image
              alt=""
              aria-hidden="true"
              className="z-10 object-cover opacity-[0.04] max-lg:scale-[2] max-md:scale-[3]"
              draggable={false}
              loading="lazy"
              src={binarySvg}
              fill
            />
          </div>
        </div>
      </div>
    </section>
  );
}
