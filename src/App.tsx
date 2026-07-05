import { useSupabase } from "./contexts/SupabaseContext";
import AuthScreen from "./components/AuthScreen";
import PhoneSimulator from "./components/PhoneSimulator";

export default function App() {
  const { user, loading } = useSupabase();

  if (loading) {
    return (
      <div className="w-screen h-screen bg-[#070b13] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#14b8a6] to-[#0a4d52] mx-auto flex items-center justify-center animate-pulse">
            <span className="text-xl font-black text-white">R</span>
          </div>
          <p className="text-slate-400 text-sm font-medium">Cargando Red On...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return <PhoneSimulator />;
}
