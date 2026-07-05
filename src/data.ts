import { Chat } from "./types";

export const INITIAL_CHATS: Chat[] = [
  {
    id: "leslie",
    name: "Leslie 🦋",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80",
    status: "online",
    lastMessage: "I guess, we have to wait...",
    lastMessageTime: "11:02 a.m.",
    unreadCount: 3,
    messages: [
      {
        id: "leslie_1",
        sender: "other",
        text: "Hey! what's the update?",
        timestamp: "11:02 a.m.",
        type: "text"
      },
      {
        id: "leslie_2",
        sender: "me",
        text: "Yeah, will be up in a minute.",
        timestamp: "11:03 a.m.",
        type: "text"
      },
      {
        id: "leslie_3",
        sender: "other",
        text: "Are you sure? I dont see it.",
        timestamp: "11:02 a.m.",
        type: "text"
      },
      {
        id: "leslie_4",
        sender: "other",
        text: "Is it really today?",
        timestamp: "11:02 a.m.",
        type: "text"
      },
      {
        id: "leslie_5",
        sender: "me",
        text: "Wel no, I think is not today.",
        timestamp: "11:03 a.m.",
        type: "text"
      },
      {
        id: "leslie_6",
        sender: "other",
        text: "Ou, I see! i was hoping ....",
        timestamp: "11:02 a.m.",
        type: "text"
      },
      {
        id: "leslie_7",
        sender: "me",
        text: "Yeah, me too, i really wanna see it.",
        timestamp: "11:03 a.m.",
        type: "text"
      },
      {
        id: "leslie_8",
        sender: "other",
        text: "I guess, we have to wait...",
        timestamp: "11:02 a.m.",
        type: "text"
      }
    ]
  },
  {
    id: "nelson",
    name: "Nelson",
    avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80",
    status: "online",
    lastMessage: "¡Te envié un sticker! 🖼️",
    lastMessageTime: "8:32 a.m.",
    unreadCount: 1,
    messages: [
      {
        id: "m1",
        sender: "other",
        text: "¡Hola! ¿Cómo va el desarrollo de la aplicación móvil?",
        timestamp: "8:30 a.m.",
        type: "text",
        reactions: { "👍": 2, "🔥": 1 }
      },
      {
        id: "m2",
        sender: "me",
        text: "¡Todo excelente! Estoy implementando el soporte completo de Safe Area y llamadas con filtros.",
        timestamp: "8:31 a.m.",
        type: "text",
        reactions: { "❤️": 1 }
      },
      {
        id: "m3",
        sender: "other",
        text: "¡Te envié un sticker! 🖼️",
        timestamp: "8:32 a.m.",
        type: "image",
        mediaUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80",
        reactions: { "😆": 3 }
      }
    ]
  },
  {
    id: "grupo_redon",
    name: "Desarrolladores Red On 🚀",
    avatar: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=120&q=80",
    status: "online",
    lastMessage: "Andrés: Creé la encuesta para la reunión de mañana.",
    lastMessageTime: "Ayer",
    unreadCount: 0,
    messages: [
      {
        id: "mg1",
        sender: "other",
        text: "Bienvenidos al canal oficial de desarrollo.",
        timestamp: "Ayer 10:00 a.m.",
        type: "text"
      },
      {
        id: "mg2",
        sender: "other",
        text: "Andrés: Creé la encuesta para la reunión de mañana.",
        timestamp: "Ayer 11:15 a.m.",
        type: "poll",
        pollQuestion: "¿A qué hora preferimos la reunión grupal?",
        pollOptions: [
          { id: "o1", text: "9:00 a.m. (GMT-5)", votes: 4, votedUsers: ["me", "nelson"] },
          { id: "o2", text: "2:00 p.m. (GMT-5)", votes: 2, votedUsers: [] },
          { id: "o3", text: "5:00 p.m. (GMT-5)", votes: 1, votedUsers: [] }
        ]
      }
    ]
  },
  {
    id: "sofia",
    name: "Sofía Castro",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80",
    status: "offline",
    lastMessage: "Escucha esta canción que produje ayer 🎵",
    lastMessageTime: "2 de Jul",
    unreadCount: 0,
    messages: [
      {
        id: "ms1",
        sender: "other",
        text: "Escucha esta canción que produje ayer 🎵",
        timestamp: "2 de Jul 4:10 p.m.",
        type: "audio",
        mediaUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        fileName: "Chill_Beats_2026.mp3",
        fileSize: "4.8 MB",
        duration: "3:42"
      }
    ]
  }
];
