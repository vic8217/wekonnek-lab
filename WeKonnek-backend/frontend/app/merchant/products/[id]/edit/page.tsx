import ProductCatalogueForm from '@/components/ProductCatalogueForm';
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ProductCatalogueForm productId={Number(id)} />; }
