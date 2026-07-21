import { get, set, del, keys } from "idb-keyval";

export async function getItem<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key);
  } catch {
    return undefined;
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    await set(key, value);
  } catch (e) {
    console.warn("[storageService] setItem error:", e);
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await del(key);
  } catch (e) {
    console.warn("[storageService] removeItem error:", e);
  }
}

export async function getKeys(): Promise<string[]> {
  try {
    return await keys();
  } catch {
    return [];
  }
}
