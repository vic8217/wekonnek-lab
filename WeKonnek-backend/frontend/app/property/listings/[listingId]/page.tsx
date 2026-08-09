import { redirect } from 'next/navigation';
export default async function CanonicalPropertyListingPage({params}:{params:Promise<{listingId:string}>}){const {listingId}=await params;redirect(`/property/${listingId}`);}
