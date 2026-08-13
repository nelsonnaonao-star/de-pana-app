export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  text TEXT,
  timestamp TEXT NOT NULL,
  raw_created_at TEXT,
  type TEXT NOT NULL,
  media_url TEXT,
  file_name TEXT,
  file_size TEXT,
  duration TEXT,
  reactions TEXT,
  poll_question TEXT,
  poll_options TEXT,
  latitude REAL,
  longitude REAL,
  location_name TEXT,
  status TEXT,
  forwarded INTEGER DEFAULT 0,
  edited INTEGER DEFAULT 0,
  reply_to_id TEXT,
  reply_to_text TEXT,
  reply_to_sender TEXT,
  price TEXT,
  poster_url TEXT,
  local_video_url TEXT,
  chat_id TEXT NOT NULL,
  synced INTEGER DEFAULT 1,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  is_group INTEGER DEFAULT 0,
  avatar TEXT,
  avatar_color TEXT,
  last_message TEXT,
  last_message_time TEXT,
  unread_count INTEGER DEFAULT 0,
  is_online INTEGER DEFAULT 0,
  phone TEXT,
  username TEXT,
  bio TEXT,
  profile_id TEXT,
  admin_id TEXT,
  partner_user_id TEXT,
  last_message_time_raw TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  contact_user_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  avatar TEXT,
  bio TEXT,
  type TEXT DEFAULT 'human',
  color_theme TEXT,
  is_group INTEGER DEFAULT 0,
  is_favorite INTEGER DEFAULT 0,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(raw_created_at);
CREATE INDEX IF NOT EXISTS idx_messages_synced ON messages(synced);
CREATE INDEX IF NOT EXISTS idx_chats_last_message_time ON chats(last_message_time);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  caption TEXT,
  background TEXT,
  created_at TEXT,
  profiles_name TEXT,
  profiles_avatar_url TEXT,
  payload TEXT,
  synced INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stories_user_id ON stories(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_created_at ON stories(created_at);

CREATE TABLE IF NOT EXISTS call_rooms (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  participant_count INTEGER DEFAULT 1,
  is_group_call INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_rooms_chat_id ON call_rooms(chat_id);
`;
