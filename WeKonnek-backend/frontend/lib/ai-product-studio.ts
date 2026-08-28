export type ProductStudioStatus = "ready" | "uploading" | "validating" | "queued" | "generating" | "review" | "failed" | "approved" | "published" | "rejected";

export type ProductStudioGeneration = {
  id: string;
  originalImageUrl: string;
  generatedImageUrl?: string;
  category: string;
  status: ProductStudioStatus;
  creditsUsed: number;
  createdAt: string;
  productName?: string;
};

type StoredGeneration = Omit<ProductStudioGeneration, "category" | "productName"> & { category?: { name?: string }; product?: { name?: string } };

export interface AIProductStudioService {
  getCreditBalance(): Promise<number>;
  validateProductImage(file: File): Promise<void>;
  createGeneration(input: { productId: number; categoryId: number; originalMediaId: string; style: string }): Promise<ProductStudioGeneration>;
  getGenerationStatus(id: string): Promise<ProductStudioGeneration>;
  getHistory(): Promise<ProductStudioGeneration[]>;
  approveGeneration(id: string): Promise<void>;
  rejectGeneration(id: string): Promise<void>;
  regenerate(id: string): Promise<ProductStudioGeneration>;
  getCreditHistory(): Promise<Array<{ id: string; credits: number; description: string; createdAt: string }>>;
}

export const aiProductStudioService: AIProductStudioService = {
  async getCreditBalance() { return 18; },
  async validateProductImage(file) { if (!file.type.startsWith("image/")) throw new Error("Please select an image file."); },
  async createGeneration(input) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch("/api/backend/product-studio/generations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    if (!response.ok) throw new Error("Unable to save Product Studio image");
    const item = await response.json();
    return { id: item.id, originalImageUrl: item.originalImageUrl, generatedImageUrl: item.generatedImageUrl, category: item.category?.name || "Product", status: item.status, creditsUsed: item.creditsUsed, createdAt: item.createdAt, productName: item.product?.name };
  },
  async getGenerationStatus(id) { return { id, originalImageUrl: "", status: "review", creditsUsed: 1, category: "Other Products", createdAt: new Date().toISOString() }; },
  async getHistory() {
    const token = getToken();
    if (!token) return [];
    const response = await fetch("/api/backend/product-studio/mine", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    const items = await response.json();
    return (items as StoredGeneration[]).map((item) => ({ id: item.id, originalImageUrl: item.originalImageUrl, generatedImageUrl: item.generatedImageUrl, category: item.category?.name || "Product", status: item.status, creditsUsed: item.creditsUsed, createdAt: item.createdAt, productName: item.product?.name }));
  },
  async approveGeneration(id) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch(`/api/backend/product-studio/generations/${id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Unable to approve Product Studio image");
  },
  async rejectGeneration() {},
  async regenerate(id) { return { id, originalImageUrl: "", status: "review", creditsUsed: 1, category: "Other Products", createdAt: new Date().toISOString() }; },
  async getCreditHistory() { return []; },
};
import { getToken } from "@/hooks/use-auth";
