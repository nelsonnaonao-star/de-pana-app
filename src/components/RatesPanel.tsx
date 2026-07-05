import React, { useState, useEffect } from "react";
import { apiUrl } from "../lib/api";
import { 
  TrendingUp, Calculator, DollarSign, Euro, 
  ShieldAlert, Check, RefreshCw
} from "lucide-react";

interface RateItem {
  id: string;
  name: string;
  symbol: string;
  value: number; // in VES
  change: string;
  isUp: boolean;
  source: string;
  time: string;
}

const FALLBACK_RATES: RateItem[] = [
  {
    id: "usd_paralelo",
    name: "Dólar Paralelo",
    symbol: "$",
    value: 667.05,
    change: "+0.00%",
    isUp: true,
    source: "Mercado Paralelo",
    time: "Cargando...",
  },
  {
    id: "eur_paralelo",
    name: "Euro Paralelo",
    symbol: "€",
    value: 763.19,
    change: "+0.00%",
    isUp: true,
    source: "Mercado Paralelo",
    time: "Cargando...",
  },
];

export default function RatesPanel() {
  const [rates, setRates] = useState<RateItem[]>(FALLBACK_RATES);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState<string>("100");
  const [selectedRateId, setSelectedRateId] = useState<string>("usd_bcv");

  const activeRate = rates.find(r => r.id === selectedRateId) || rates[0] || null;

  // Calculations
  const numAmount = Number(amount) || 0;
  const rateValue = activeRate?.value || 0;
  const result = numAmount * rateValue;

  async function fetchRates() {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/rates/dollar"));
      if (res.ok) {
        const data = await res.json();
        setRates([
          {
            id: "usd_bcv",
            name: data.usd.name,
            symbol: data.usd.symbol,
            value: data.usd.value,
            change: data.usd.change,
            isUp: data.usd.isUp,
            source: data.usd.source,
            time: data.usd.time,
          },
          {
            id: "eur_bcv",
            name: data.eur.name,
            symbol: data.eur.symbol,
            value: data.eur.value,
            change: data.eur.change,
            isUp: data.eur.isUp,
            source: data.eur.source,
            time: data.eur.time,
          },
        ]);
        setLastUpdated(data.updatedAt);
      }
    } catch (e) {
      console.warn("Failed to fetch rates:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 bg-[#f1f5f9] flex flex-col h-full overflow-hidden select-none">
      
      {/* HEADER */}
      <div className="bg-gradient-to-r from-[#0a4d52] to-[#05292c] text-white px-4 py-3 shrink-0 z-10 shadow-sm text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-lg bg-teal-400/20 flex items-center justify-center">
              <TrendingUp className="w-3 h-3 text-teal-300" />
            </div>
            <h3 className="text-xs font-black tracking-tight">Tasas y Calculadora</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] bg-teal-500/20 text-teal-200 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-teal-400/20">
              Paralelo
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
            Mercado Paralelo — tasa en tiempo real
          </p>
          {lastUpdated && (
            <span className="text-[6px] text-teal-300/40 font-mono">
              {new Date(lastUpdated).toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}
            </span>
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
                    <span className={`text-[6px] font-mono font-bold px-1 rounded ${
                      isSelected
                        ? "bg-white/15 text-white/80"
                        : rate.isUp ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    }`}>
                      {rate.change}
                    </span>
                  </div>
                </button>
              );
            })}
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
                Tasa: {(rateValue).toFixed(2)} Bs.
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
              <span className="text-xl font-extrabold font-mono tracking-tight text-teal-400">
                {(result || 0).toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.
              </span>
            </div>
          </div>

        </div>

        {/* Disclaimer */}
        <div className="bg-slate-50/80 rounded-2xl p-2.5 border border-slate-200/30 flex gap-2 items-start">
          <ShieldAlert className="w-3 h-3 text-teal-600 shrink-0 mt-0.5" />
          <p className="text-[7px] text-slate-500 leading-relaxed font-medium">
            Tasas del mercado paralelo venezolano actualizadas periódicamente. Usa la calculadora para convertir entre divisas y bolívares.
          </p>
        </div>

      </div>
    </div>
  );
}
