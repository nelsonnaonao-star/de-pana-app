import { supabase } from "../lib/supabase";
import { apiUrl, authFetch } from "../lib/api";
import toast from "react-hot-toast";

export type Profile = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  avatar_url?: string;
  bio: string;
  role: string;
  status: "online" | "offline";
  phone_number: string;
  username: string;
  real_email?: string;
  pin?: string;
  bubble_color?: string;
  partner_bubble_color?: string;
  notif_config?: Record<string, boolean>;
  created_at: string;
  updated_at: string;
};

async function trySignIn(email: string, password: string) {
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error) console.debug("[AUTH] signIn fail:", email, result.error.message);
  return result;
}

export async function login(identifier: string, password: string) {
  const input = identifier.toLowerCase().trim().replace(/^@/, "");
  const cleanPhone = input.replace(/[\s+()\-]/g, "");

  console.debug("[LOGIN] Buscando perfil para:", input);

  const { data: profiles, error: searchErr } = await supabase
    .from("profiles")
    .select("id, username, phone_number, name, avatar_url, bio")
    .or(`username.eq.${input},phone_number.eq.${cleanPhone}`)
    .limit(1);

  if (searchErr) {
    console.error("[LOGIN] Error búsqueda:", searchErr);
    throw new Error("Error al buscar usuario");
  }

  let profile = profiles?.[0] || null;

  if (!profile && cleanPhone.length >= 4) {
    console.debug("[LOGIN] Fallback ILIKE para:", cleanPhone);
    const { data: all } = await supabase
      .from("profiles")
      .select("id, username, phone_number, name, avatar_url, bio")
      .ilike("phone_number", `%${cleanPhone}%`)
      .limit(20);
    profile = all?.find((p) => p.phone_number && p.phone_number.replace(/[\s+()\-]/g, "").includes(cleanPhone)) || null;
  }

  if (!profile) {
    throw new Error("Usuario o teléfono no encontrado. Verifica tus datos.");
  }

  console.debug("[LOGIN] Perfil encontrado:", profile.username);

  const { data, error } = await trySignIn(`${profile.username}@redon.app`, password);

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      throw new Error('Contraseña incorrecta. Usa "Olvidé mi contraseña" para recuperarla.');
    }

    if (error.message.toLowerCase().includes("confirm") || error.message.toLowerCase().includes("email not confirmed")) {
      console.debug("[LOGIN] Auto-confirm necesario");
      try {
        await authFetch(apiUrl("/api/auth/auto-confirm"), {
          method: "POST",
          body: JSON.stringify({ userId: profile.id }),
        });
      } catch (e) {
        console.warn("[LOGIN] Auto-confirm falló:", e);
      }

      const retry = await trySignIn(`${profile.username}@redon.app`, password);
      if (retry.error) {
        if (retry.error.message.includes("Invalid login credentials"))
          throw new Error('Contraseña incorrecta. Usa "Olvidé mi contraseña" para recuperarla.');
        throw new Error("Error de autenticación: " + retry.error.message);
      }

      toast.success("Sesión iniciada");
      return {
        token: retry.data.session.access_token,
        user: {
          id: retry.data.user.id,
          name: profile.name,
          username: profile.username,
          phone: profile.phone_number,
          avatar: profile.avatar_url || "",
          bio: profile.bio || "",
        },
      };
    }

    throw new Error("Error al iniciar sesión: " + error.message + ". Si el problema persiste, regístrate de nuevo.");
  }

  return {
    token: data.session.access_token,
    user: {
      id: data.user.id,
      name: profile.name,
      username: profile.username,
      phone: profile.phone_number,
      avatar: profile.avatar_url || "",
      bio: profile.bio || "",
    },
  };
}

export async function register(
  name: string,
  phone: string,
  username: string,
  password: string,
  realEmail?: string
) {
  const cleanUsername = username.replace(/^@/, "").toLowerCase().trim();
  const cleanPhone = phone.trim();
  const cleanEmail = realEmail?.trim().toLowerCase() || "";

  if (!/^[a-z0-9_.-]+$/.test(cleanUsername)) {
    throw new Error("El usuario solo puede contener letras, números, guiones bajos (_), puntos (.) y guiones (-). Sin espacios ni @.");
  }
  if (cleanUsername.length < 2) throw new Error("El usuario debe tener al menos 2 caracteres");

  const existing = await supabase
    .from("profiles")
    .select("id")
    .or(`username.eq.${cleanUsername},phone_number.eq.${cleanPhone}`)
    .maybeSingle();

  if (existing.data) throw new Error("El usuario o teléfono ya está registrado");

  const { data, error } = await supabase.auth.signUp({
    email: `${cleanUsername}@redon.app`,
    password,
  });

  if (error) {
    console.error("[REGISTER] signUp error:", error);
    throw new Error(error.message);
  }
  if (!data.user) throw new Error("Error al crear usuario");

  try {
    await authFetch(apiUrl("/api/auth/auto-confirm"), {
      method: "POST",
      body: JSON.stringify({ userId: data.user.id }),
    });
  } catch (e) {
    console.warn("[REGISTER] Auto-confirm falló:", e);
  }

  const { error: upsertError } = await supabase.from("profiles").upsert({
    id: data.user.id,
    name,
    username: cleanUsername,
    phone_number: cleanPhone,
    avatar_url: "",
    bio: "Disponible en RED ON",
    ...(cleanEmail ? { real_email: cleanEmail } : {}),
  });

  if (upsertError && !upsertError.message?.includes("duplicate key")) {
    console.error("[REGISTER] Upsert error:", upsertError);
    throw new Error(upsertError.message || "Error al crear perfil");
  }

  let token = data.session?.access_token || "";
  if (!token) {
    const signInRes = await trySignIn(`${cleanUsername}@redon.app`, password);
    if (signInRes.data.session) token = signInRes.data.session.access_token;
  }

  toast.success("Cuenta creada exitosamente");
  return {
    token,
    user: {
      id: data.user.id,
      name,
      username: cleanUsername,
      phone: cleanPhone,
      avatar: "",
      bio: "Disponible en RED ON",
      realEmail: cleanEmail,
    },
  };
}

export async function resetPassword(identifier: string) {
  const input = identifier.toLowerCase().trim().replace(/^@/, "");
  let email = `${input}@redon.app`;
  let userFound = false;

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, real_email")
      .or(`username.eq.${input},phone_number.eq.${input}`)
      .single();

    if (profile) {
      userFound = true;
      email = profile.real_email ? profile.real_email : `${profile.username}@redon.app`;
    }
  } catch {}

  if (!userFound) throw new Error("No encontramos una cuenta con ese usuario o teléfono.");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    if (error.message.includes("Email not found")) throw new Error("No encontramos una cuenta con ese usuario o teléfono.");
    throw new Error("Error al enviar el correo de recuperación: " + error.message);
  }

  toast.success("Correo de recuperación enviado");
  return { email };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data as Profile;
}

export async function updateProfile(id: string, updates: Partial<Profile>) {
  const { error } = await supabase
    .from("profiles")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export function onAuthChange(callback: (user: any) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user || null);
  });
}
