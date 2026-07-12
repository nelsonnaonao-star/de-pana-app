import React from "react";
import { MessageSquareMore, CircleDotDashed, Users, TrendingUp, Briefcase, CircleUser } from "lucide-react";

interface BottomTabBarProps {
  currentScreen: string;
  setCurrentScreen: (screen: any) => void;
  isEditingMedia: boolean;
  totalUnread?: number;
}

const TABS = [
  { id: "chats", label: "Chats", icon: MessageSquareMore },
  { id: "contacts", label: "Contactos", icon: Users },
  { id: "states", label: "Estados", icon: CircleDotDashed },
  { id: "rates", label: "Tasas", icon: TrendingUp },
  { id: "business", label: "Negocio", icon: Briefcase },
  { id: "profile", label: "Perfil", icon: CircleUser },
];

export default function BottomTabBar({ currentScreen, setCurrentScreen, isEditingMedia, totalUnread = 0 }: BottomTabBarProps) {
  if (isEditingMedia) return null;

  return (
    <div className="border-t border-slate-100 bg-white py-2 shrink-0 z-20">
      <div className="grid grid-cols-6 text-center px-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentScreen === tab.id;
          const showBadge = tab.id === "chats" && totalUnread > 0;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentScreen(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 relative group cursor-pointer ${
                isActive ? "text-[#10646a]" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <div className={`p-1.5 rounded-xl transition-all relative ${
                isActive ? "bg-[#10646a]/10 scale-105" : "bg-transparent"
              }`}>
                <Icon className="w-4 h-4" />
                {showBadge && (
                  <span className="absolute -top-1 -right-2 bg-[#25D366] text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-white z-30 shadow-sm">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </div>
              <span className={`text-[9px] ${isActive ? "font-bold" : "font-medium"} tracking-tight`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
