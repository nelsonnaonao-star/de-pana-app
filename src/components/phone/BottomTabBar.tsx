import React from "react";
import { MessageSquareMore, CircleDotDashed, Users, TrendingUp, Briefcase, CircleUser } from "lucide-react";

interface BottomTabBarProps {
  currentScreen: string;
  setCurrentScreen: (screen: any) => void;
  isEditingMedia: boolean;
}

const TABS = [
  { id: "chats", label: "Chats", icon: MessageSquareMore },
  { id: "contacts", label: "Contactos", icon: Users },
  { id: "states", label: "Estados", icon: CircleDotDashed },
  { id: "rates", label: "Tasas", icon: TrendingUp },
  { id: "business", label: "Negocio", icon: Briefcase },
  { id: "profile", label: "Perfil", icon: CircleUser },
];

export default function BottomTabBar({ currentScreen, setCurrentScreen, isEditingMedia }: BottomTabBarProps) {
  if (isEditingMedia) return null;

  return (
    <div className="border-t border-slate-100 bg-white py-2 shrink-0 z-20">
      <div className="grid grid-cols-6 text-center px-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentScreen === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentScreen(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 relative group cursor-pointer ${
                isActive ? "text-[#10646a]" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <div className={`p-1.5 rounded-xl transition-all ${
                isActive ? "bg-[#10646a]/10 scale-105" : "bg-transparent"
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`text-[9px] ${isActive ? "font-bold" : "font-medium"} tracking-tight`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
