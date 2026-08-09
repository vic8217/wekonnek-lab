import BazaarListingForm from '@/components/listings/BazaarListingForm';
export default async function PostBazaarItemPage({searchParams}:{searchParams:Promise<{mode?:string}>}){const query=await searchParams;return <BazaarListingForm displayMode={query.mode==='embedded'?'embedded':'pwa'}/>;}
