import { apiUrl } from "../lib/api";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url));
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

export async function getProfileFromServer(userId: string) {
  return get<any>(`/api/data/profile/${userId}`);
}

export async function getChatsFromServer(userId: string) {
  return get<any[]>(`/api/data/chats/${userId}`);
}

export async function getContactsFromServer(userId: string) {
  return get<any[]>(`/api/data/contacts/${userId}`);
}

export async function getCallsFromServer(userId: string) {
  return get<any[]>(`/api/data/calls/${userId}`);
}

export async function getAllUserData(userId: string) {
  return get<{
    profile: any;
    chats: any[];
    contacts: any[];
    calls: any[];
  }>(`/api/data/all/${userId}`);
}
