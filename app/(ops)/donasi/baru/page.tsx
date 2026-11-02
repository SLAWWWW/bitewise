import { Header } from '@/components/layout/Header';
import { Section } from '../../ringkasan/_parts';
import { IntakeForm } from '@/components/direct/Actions';
import { directPage } from '@/src/application/direct/page-context';
import { intakeReferences } from '@/src/application/direct/queries';
export const metadata={title:'Donasi baru — Lumbung'};
export default async function NewDonationPage(){
  const {t,tx,can}=await directPage();const refs=await tx(intakeReferences);
  return <><Header title={t('newDonation')}/><div className="direct-page"><Section id="intake" title={t('direct')} subtitle={t('simulate')}>
    {can('donation.create')?<IntakeForm refs={refs}/>:<p>{t('permission')}</p>}
  </Section></div></>;
}
