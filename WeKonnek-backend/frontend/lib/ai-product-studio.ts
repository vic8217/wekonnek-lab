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

export interface AIProductStudioService {
  getCreditBalance(): Promise<number>;
  validateProductImage(file: File): Promise<void>;
  createGeneration(input: Pick<ProductStudioGeneration, "originalImageUrl" | "category">): Promise<ProductStudioGeneration>;
  getGenerationStatus(id: string): Promise<ProductStudioGeneration>;
  approveGeneration(id: string): Promise<void>;
  rejectGeneration(id: string): Promise<void>;
  regenerate(id: string): Promise<ProductStudioGeneration>;
  getCreditHistory(): Promise<Array<{ id: string; credits: number; description: string; createdAt: string }>>;
}

// TODO: replace this browser-only mock with a merchant-scoped backend API.
export const aiProductStudioService: AIProductStudioService = {
  async getCreditBalance() { return 18; },
  async validateProductImage(file) { if (!file.type.startsWith("image/")) throw new Error("Please select an image file."); },
  async createGeneration(input) { return { id: crypto.randomUUID(), ...input, status: "review", creditsUsed: 1, generatedImageUrl: input.originalImageUrl, createdAt: new Date().toISOString() }; },
  async getGenerationStatus(id) { return { id, originalImageUrl: "", status: "review", creditsUsed: 1, category: "Other Products", createdAt: new Date().toISOString() }; },
  async approveGeneration() {},
  async rejectGeneration() {},
  async regenerate(id) { return { id, originalImageUrl: "", status: "review", creditsUsed: 1, category: "Other Products", createdAt: new Date().toISOString() }; },
  async getCreditHistory() { return []; },
};
