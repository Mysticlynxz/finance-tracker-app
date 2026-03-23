import { ID, Models, Query } from "appwrite";
import { APPWRITE_DATABASE_ID, databases, getCurrentUser, getErrorMessage } from "./appwrite";

const APPWRITE_CATEGORIES_COLLECTION_ID = "categories";

export interface CategoryDocument extends Models.Document {
  name: string;
  icon: string;
  userId: string;
}

const buildCategoryIcon = (name: string) => {
  const trimmedName = name.trim();
  return trimmedName.charAt(0).toUpperCase();
};

export const createCategory = async (name: string): Promise<CategoryDocument> => {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Category name is required.");
  }

  try {
    const user = await getCurrentUser();

    return await databases.createDocument<CategoryDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_CATEGORIES_COLLECTION_ID,
      documentId: ID.unique(),
      data: {
        name: trimmedName,
        icon: buildCategoryIcon(trimmedName),
        userId: user.$id,
      },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] createCategory failed:", message);
    throw new Error(message);
  }
};

export const getCategories = async (): Promise<CategoryDocument[]> => {
  try {
    const user = await getCurrentUser();

    const response = await databases.listDocuments<CategoryDocument>({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: APPWRITE_CATEGORIES_COLLECTION_ID,
      queries: [Query.equal("userId", user.$id)],
    });

    return [...response.documents].sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[Appwrite] getCategories failed:", message);
    throw new Error(message);
  }
};
