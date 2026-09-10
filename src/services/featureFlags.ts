import { supabase } from "../lib/supabase";

const FLAG_RPC = "get_feature_flag";
const FLAG_NAME = "flyer_paywall_active";

/**
 * Lee el feature flag que controla el paywall de Publicar Flyer.
 *   false = MODO PRUEBA: se publica libre, sin exigir membresía.
 *   true  = MODO PRODUCCIÓN: exige membresía vigente (comportamiento actual).
 * Si la lectura falla (flag no instalado aún, sin red, etc.) devuelve true
 * para mantener el comportamiento actual y no abrir el paywall por error.
 */
export async function getFlyerPaywallActive(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(FLAG_RPC, { p_name: FLAG_NAME });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.warn("[featureFlags] No se pudo leer flyer_paywall_active:", err);
    return true;
  }
}