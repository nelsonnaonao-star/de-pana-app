import React, { useState, useEffect } from "react";
import { 
  TrendingUp, Calculator, DollarSign, Euro, 
  ShieldCheck, Check, RefreshCw
} from "lucide-react";

interface RateItem {
  id: string;
  name: string;
  symbol: string;
  value: number;
  source: string;
  date: string;
}

const FALLBACK_RATES: RateItem[] = [
  {
    id: "usd_bcv",
    name: "Dólar BCV",
    symbol: "$",
    value: 721.35,
    source: "Banco Central de Venezuela",
    date: "Cargando...",
  },
  {
    id: "eur_bcv",
    name: "Euro BCV",
    symbol: "€",
    value: 823.94,
    source: "Banco Central de Venezuela",
    date: "Cargando...",
  },
];

export default function RatesPanel() {
  const [rates, setRates] = useState<RateItem[]>(FALLBACK_RATES);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [timeAgo, setTimeAgo] = useState<string>("");

  const [amount, setAmount] = useState<string>("");
  const [selectedRateId, setSelectedRateId] = useState<string>("usd_bcv");

  const activeRate = rates.find(r => r.id === selectedRateId) || rates[0];

  const numAmount = Number(amount) || 0;
  const rateValue = activeRate?.value || 0;
  const result = numAmount * rateValue;

  function getTimeAgo(isoString: string): string {
    if (!isoString) return "";
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "ahora mismo";
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `hace ${days}d`;
  }

  async function fetchRates() {
    setLoading(true);

    // Source 1: Server (has DB cache + multi-source fallback)
    async function tryServer(): Promise<RateItem[]> {
      const serverUrl = import.meta.env.VITE_SERVER_URL;
      if (!serverUrl) throw new Error("No server URL");
      const res = await fetch(`${serverUrl}/api/rates/dollar`, {
        cache: "no-cache",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      const rates: RateItem[] = [];
      if (data.usd?.value) {
        rates.push({
          id: "usd_bcv", name: data.usd.name || "Dólar BCV", symbol: "$",
          value: data.usd.value, source: data.usd.source || "BCV",
          date: data.usd.time || data.updatedAt || "",
        });
      }
      if (data.eur?.value) {
        rates.push({
          id: "eur_bcv", name: data.eur.name || "Euro BCV", symbol: "€",
          value: data.eur.value, source: data.eur.source || "BCV",
          date: data.eur.time || data.updatedAt || "",
        });
      }
      if (rates.length === 0) throw new Error("No rates from server");
      return rates;
    }

    // Source 2: ve.dolarapi.com (direct, no server needed)
    async function tryDirectApi(): Promise<RateItem[]> {
      const [usdRes, eurRes] = await Promise.all([
        fetch("https://ve.dolarapi.com/v1/dolares/oficial", { signal: AbortSignal.timeout(8000) }),
        fetch("https://ve.dolarapi.com/v1/euros/oficial", { signal: AbortSignal.timeout(8000) }),
      ]);
      if (!usdRes.ok) throw new Error(`dolarapi ${usdRes.status}`);
      const usdData = await usdRes.json();
      const eurData = eurRes.ok ? await eurRes.json() : null;
      const rates: RateItem[] = [];
      if (usdData.promedio) {
        rates.push({
          id: "usd_bcv", name: "Dólar BCV", symbol: "$",
          value: usdData.promedio, source: "Banco Central de Venezuela",
          date: usdData.fechaActualizacion || "",
        });
      }
      if (eurData?.promedio) {
        rates.push({
          id: "eur_bcv", name: "Euro BCV", symbol: "€",
          value: eurData.promedio, source: "Banco Central de Venezuela",
          date: eurData.fechaActualizacion || "",
        });
      }
      if (rates.length === 0) throw new Error("No rates from dolarapi");
      return rates;
    }

    // Source 3: bcv.today (last resort)
    async function tryBcvToday(): Promise<RateItem[]> {
      const res = await fetch("https://bcv.today/api/v1/rate.json", {
        cache: "no-cache", signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`bcv.today ${res.status}`);
      const data = await res.json();
      const rates: RateItem[] = [];
      if (data.USD) {
        rates.push({
          id: "usd_bcv", name: "Dólar BCV", symbol: "$",
          value: data.USD, source: "Banco Central de Venezuela",
          date: data.effective_date || "",
        });
      }
      if (data.EUR) {
        rates.push({
          id: "eur_bcv", name: "Euro BCV", symbol: "€",
          value: data.EUR, source: "Banco Central de Venezuela",
          date: data.effective_date || "",
        });
      }
      if (rates.length === 0) throw new Error("No rates from bcv.today");
      return rates;
    }

    try {
      let newRates: RateItem[] = [];
      try { newRates = await tryServer(); } catch {
        try { newRates = await tryDirectApi(); } catch {
          try { newRates = await tryBcvToday(); } catch (e) {
            console.warn("All rate sources failed:", e);
          }
        }
      }
      if (newRates.length > 0) {
        setRates(newRates);
        setLastUpdated(new Date().toISOString());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRates();

    const interval = setInterval(fetchRates, 30 * 60 * 1000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRates();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!lastUpdated) return;
    setTimeAgo(getTimeAgo(lastUpdated));
    const timer = setInterval(() => setTimeAgo(getTimeAgo(lastUpdated)), 30000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const rateDate = activeRate?.date || "";

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden select-none">
      
      {/* HEADER */}
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 z-10 shadow-sm text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-lg bg-teal-400/20 flex items-center justify-center">
              <TrendingUp className="w-3 h-3 text-teal-300" />
            </div>
            <h3 className="text-xs font-black tracking-tight">Tasas BCV Oficiales</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] bg-emerald-500/20 text-emerald-200 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-emerald-400/20 flex items-center gap-0.5">
              <ShieldCheck className="w-2.5 h-2.5" />
              BCV Oficial
            </span>
            <button
              onClick={fetchRates}
              disabled={loading}
              className="p-1 text-teal-300 hover:text-white transition-colors disabled:opacity-50"
              title="Actualizar"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[7px] text-teal-100/70 font-mono">
            Fuente: Banco Central de Venezuela — {rateDate}
          </p>
          {lastUpdated && (
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${
                Date.now() - new Date(lastUpdated).getTime() < 30 * 60000
                  ? "bg-emerald-400 animate-pulse"
                  : Date.now() - new Date(lastUpdated).getTime() < 60 * 60000
                    ? "bg-amber-400"
                    : "bg-red-400"
              }`} />
              <span className="text-[6px] text-teal-300/40 font-mono">
                {timeAgo || ""}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-left">

        {/* RATE SELECTOR */}
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-3 space-y-2 border border-white/60">
          <div className="flex items-center gap-1.5">
            <Calculator className="w-3 h-3 text-teal-500" />
            <span className="text-[7px] font-bold uppercase text-slate-400 tracking-wider">
              Tasa activa
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {rates.map((rate) => {
              const isSelected = selectedRateId === rate.id;
              const isUsd = rate.id.includes("usd");

              return (
                <button
                  key={rate.id}
                  onClick={() => setSelectedRateId(rate.id)}
                  className={`relative p-2.5 rounded-xl text-left transition-all cursor-pointer active:scale-[0.97] ${
                    isSelected
                      ? "bg-gradient-to-br from-teal-600 to-[#0a4d52] text-white shadow-lg shadow-teal-900/20"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-800 shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-lg flex items-center justify-center text-[9px] font-bold ${
                        isSelected
                          ? "bg-white/15 text-white"
                          : isUsd ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {isUsd ? <DollarSign className="w-2.5 h-2.5" /> : <Euro className="w-2.5 h-2.5" />}
                      </div>
                      <span className={`text-[8px] font-bold truncate max-w-[70px] ${
                        isSelected ? "text-white/80" : "text-slate-600"
                      }`}>
                        {rate.name}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="w-3 h-3 bg-white/20 rounded-full flex items-center justify-center">
                        <Check className="w-2 h-2 stroke-[3] text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between mt-1.5">
                    <span className={`text-[11px] font-mono font-black leading-none ${
                      isSelected ? "text-white" : "text-slate-900"
                    }`}>
                      {rate.value.toFixed(2)} Bs.
                    </span>
                  </div>
                  <div className={`text-[5px] font-mono mt-0.5 ${
                    isSelected ? "text-white/50" : "text-slate-400"
                  }`}>
                    {rate.source}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Source indicator */}
          <div className="flex items-center justify-center gap-1 pt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-[7px] text-slate-400 font-mono">
              Tasa oficial BCV — Fuente: Banco Central de Venezuela
            </span>
          </div>
        </div>

        {/* CALCULATOR */}
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-3 space-y-2 border border-white/60">

          <div className="bg-[#0a4d52] rounded-2xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[7px] font-mono font-semibold text-teal-300/80 uppercase">
                Monto en {activeRate?.symbol || "$"}
              </span>
              <span className="text-[7px] font-mono text-teal-300/50">
                Tasa: {rateValue.toFixed(4)} Bs.
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-mono font-bold text-teal-300">
                {activeRate?.symbol || "$"}
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-transparent text-3xl font-black font-mono tracking-tight text-white outline-none w-full [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0"
              />
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-[7px] font-mono font-semibold text-teal-300/80 uppercase">
                Resultado en Bs.
              </span>
              <div className="flex items-center gap-2">
                {amount !== "" && (
                  <button
                    onClick={() => setAmount("")}
                    className="text-[8px] font-black text-teal-300/60 hover:text-teal-200 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded-lg transition-all cursor-pointer"
                    title="Limpiar"
                  >
                    Limpiar
                  </button>
                )}
                <span className="text-xl font-extrabold font-mono tracking-tight text-teal-400">
                  {(result || 0).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Disclaimer */}
        <div className="bg-slate-50/80 rounded-2xl p-2.5 border border-slate-200/30 flex gap-2 items-start">
          <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-[7px] text-slate-500 leading-relaxed font-medium">
            Tasas oficiales del Banco Central de Venezuela (BCV). Solo tasas oficiales, sin mercado paralelo.
          </p>
        </div>

      </div>
    </div>
  );
}
