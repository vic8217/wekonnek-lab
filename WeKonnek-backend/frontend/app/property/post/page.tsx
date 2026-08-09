import PropertyListingForm from '@/components/listings/PropertyListingForm';
export default async function PostPropertyPage({searchParams}:{searchParams:Promise<{mode?:string}>}){const query=await searchParams;return <PropertyListingForm displayMode={query.mode==='embedded'?'embedded':'pwa'}/>;}
