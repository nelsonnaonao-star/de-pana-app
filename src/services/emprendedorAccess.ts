import { supabase } from "../lib/supabase";

export type EmprendedorPlanId = "semanal" | "quincenal" | "mensual";

export interface EmprendedorPlan {
  id: EmprendedorPlanId;
  name: string;
  durationLabel: string;
  price: number;
}

export const EMPRENDEDOR_PLANS: EmprendedorPlan[] = [
  { id: "semanal", name: "Semanal", durationLabel: "7 días de publicación", price: 5 },
  { id: "quincenal", name: "Quincenal", durationLabel: "15 días de publicación", price: 10 },
  { id: "mensual", name: "Mensual", durationLabel: "30 días de publicación", price: 15 },
];

// Número del administrador (0424-130-5887 → formato internacional Venezuela)
export const ADMIN_WHATSAPP_NUMBER = "584241305887";

const CACHE_KEY = "redon_emprendedor_access_v1";

export interface EmprendedorAccessInfo {
  active: boolean;
  plan: EmprendedorPlanId | null;
  expiresOn: string | null;
  checkedAt: number;
}

function isExpired(expiresOn: string | null): boolean {
  if (!expiresOn) return true;
  try {
    return new Date(expiresOn).getTime() <= Date.now();
  } catch {
    return true;
  }
}

function readCache(): EmprendedorAccessInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmprendedorAccessInfo;
    if (typeof parsed.active !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(info: EmprendedorAccessInfo) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Consulta en Supabase la membresía vigente; si no hay red usa la caché local. */
export async function fetchEmprendedorAccess(): Promise<EmprendedorAccessInfo> {
  try {
    const { data, error } = await supabase.rpc("get_emprendedor_access");
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    const expiresOn: string | null = row?.expires_on ?? null;
    const info: EmprendedorAccessInfo = {
      active: !!row?.active && !isExpired(expiresOn),
      plan: (row?.plan as EmprendedorPlanId) ?? null,
      expiresOn,
      checkedAt: Date.now(),
    };
    writeCache(info);
    return info;
  } catch (err) {
    console.warn("[emprendedorAccess] Sin conexión, usando caché local:", err);
    const cached = readCache();
    if (cached && cached.active && !isExpired(cached.expiresOn)) return cached;
    return { active: false, plan: null, expiresOn: null, checkedAt: Date.now() };
  }
}

/** Activa una membresía con el código entregado por el administrador. */
export async function activateEmprendedorCode(
  rawCode: string
): Promise<{ ok: boolean; message: string; plan?: EmprendedorPlanId; expiresOn?: string }> {
  const cleanCode = rawCode.trim().toUpperCase();
  if (!cleanCode) {
    return { ok: false, message: "Ingresa el código que te envió el administrador." };
  }

  try {
    const { data, error } = await supabase.rpc("validate_emprendedor_code", { p_code: cleanCode });
    if (error) {
      console.error("[emprendedorAccess] RPC error:", error);
      const rawMsg: string = (error as unknown as { message?: string })?.message || "";
      const status: number | undefined = (error as unknown as { status?: number })?.status;
      if (status === 401 || status === 403 || rawMsg.toLowerCase().includes("jwt")) {
        return { ok: false, message: "Tu sesión no está activa. Inicia sesión en Red On e intenta de nuevo." };
      }
      if (status === 404 || rawMsg.includes("Could not find the function")) {
        return { ok: false, message: "La función de membresía no está instalada aún en el servidor." };
      }
      return { ok: false, message: `Error al validar el código (${status ?? "sin respuesta"}). Intenta más tarde.` };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.valid) {
      return { ok: false, message: row?.msg || "Código incorrecto o ya utilizado." };
    }

    const expiresOn: string | null = row.expires_on ?? null;
    writeCache({
      active: !isExpired(expiresOn),
      plan: (row.plan as EmprendedorPlanId) ?? null,
      expiresOn,
      checkedAt: Date.now(),
    });

    return { ok: true, message: row.msg || "¡Membresía activada!", plan: row.plan, expiresOn: expiresOn || undefined };
  } catch (err) {
    console.error("[emprendedorAccess] Network error:", err);
    return { ok: false, message: "Sin conexión. Verifica tu internet e intenta de nuevo." };
  }
}

/** Días restantes de membresía (mínimo 1 mientras esté vigente). */
export function daysRemaining(expiresOn: string | null): number {
  if (!expiresOn) return 0;
  const ms = new Date(expiresOn).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** Link de WhatsApp para contactar al administrador con mensaje prellenado. */
export function buildAdminWhatsAppUrl(plan?: EmprendedorPlan): string {
  const msg = plan
    ? `¡Hola! Soy emprendedor en Red On y quiero activar el plan ${plan.name} ($${plan.price}) para publicar mi negocio. ¿Cómo realizo el pago?`
    : "¡Hola! Quiero información sobre los planes de Red On Negocios para publicar mi negocio.";
  return `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}
