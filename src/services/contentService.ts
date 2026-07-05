import { apiUrl } from "../lib/api";

const API = '/api/content';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url));
  if (!res.ok) throw new Error(`GET ${url} failed`);
  return res.json();
}

async function post<T>(url: string, body: any): Promise<T> {
  const res = await fetch(apiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} failed`);
  return res.json();
}

async function del(url: string): Promise<void> {
  const res = await fetch(apiUrl(url), { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} failed`);
}

// ─── Stories ───────────────────────────────────────────────────────

export async function getMyStories(userId: string) {
  return get<any[]>(`${API}/stories/${userId}`);
}

export async function getAllStories() {
  return get<any[]>(`${API}/stories`);
}

export async function createStory(story: { user_id: string; type: string; content: string; caption?: string; background?: string }) {
  return post<any>(`${API}/stories`, story);
}

export async function deleteStory(id: string) {
  return del(`${API}/stories/${id}`);
}

// ─── Channels ──────────────────────────────────────────────────────

export async function getChannels() {
  return get<any[]>(`${API}/channels`);
}

export async function getChannel(id: string) {
  return get<any>(`${API}/channels/${id}`);
}

export async function createChannel(channel: { name: string; description?: string; avatar?: string; category?: string; created_by: string }) {
  return post<any>(`${API}/channels`, channel);
}

export async function subscribeToChannel(channelId: string, userId: string) {
  return post<any>(`${API}/channels/subscribe`, { channel_id: channelId, user_id: userId });
}

export async function unsubscribeFromChannel(channelId: string, userId: string) {
  return post<any>(`${API}/channels/unsubscribe`, { channel_id: channelId, user_id: userId });
}

export async function createChannelUpdate(update: { channel_id: string; text: string; image_url?: string }) {
  return post<any>(`${API}/channels/updates`, update);
}

export async function reactToChannelUpdate(updateId: string, userId: string, reaction: string) {
  return post<any>(`${API}/channels/react`, { update_id: updateId, user_id: userId, reaction });
}

// ─── Business Flyers ───────────────────────────────────────────────

export async function getMyFlyers(userId: string) {
  return get<any[]>(`${API}/flyers/${userId}`);
}

export async function getAllFlyers() {
  return get<any[]>(`${API}/flyers`);
}

export async function createFlyer(flyer: {
  user_id: string;
  business_name: string;
  description?: string;
  location?: string;
  flyer_url?: string;
  template_id?: string;
  product_name?: string;
  price?: string;
  music_url?: string;
  music_name?: string;
}) {
  return post<any>(`${API}/flyers`, flyer);
}

export async function incrementFlyerView(flyerId: string) {
  return post<any>(`${API}/flyers/view/${flyerId}`, {});
}

export async function incrementFlyerClick(flyerId: string) {
  return post<any>(`${API}/flyers/click/${flyerId}`, {});
}

export async function deleteFlyer(id: string) {
  return del(`${API}/flyers/${id}`);
}
