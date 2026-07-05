import { supabase } from "../lib/supabase";
import { apiUrl } from "../lib/api";

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

export async function login(identifier: string, password: string) {
  const input = identifier.toLowerCase().trim().replace(/^@/, "");

  async function trySignIn(email: string) {
    return supabase.auth.signInWithPassword({ email, password });
  }

  // Try direct Supabase login first (assumes username)
  let signInResult = await trySignIn(`${input}@redon.app`);
  let username = input;

  // If direct login failed, look up profile via server (handles phone numbers)
  if (signInResult.error) {
    const res = await fetch(apiUrl("/api/auth/lookup-profile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: input }),
    });
    if (!res.ok) {
      // If server fails, surface the original Supabase error
      throw new Error(
        signInResult.error.message.includes("Invalid login credentials")
          ? 'Contraseña incorrecta. Usa "Olvidé mi contraseña" para recuperarla.'
          : "Error al iniciar sesión: " + signInResult.error.message
      );
    }
    const { profile } = await res.json();
    username = profile.username;
    signInResult = await trySignIn(`${username}@redon.app`);
  }

  if (signInResult.error) {
    if (signInResult.error.message.includes("Invalid login credentials")) {
      throw new Error(
        'Contraseña incorrecta. Usa "Olvidé mi contraseña" para recuperarla.'
      );
    }
    if (
      signInResult.error.message.toLowerCase().includes("confirm") ||
      signInResult.error.message.toLowerCase().includes("email not confirmed")
    ) {
      try {
        await fetch(apiUrl("/api/auth/auto-confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: signInResult.data?.user?.id }),
        });
      } catch (e) {
        console.warn("[LOGIN] Auto-confirm failed:", e);
      }
      const retry = await trySignIn(`${username}@redon.app`);
      if (retry.error) {
        if (retry.error.message.includes("Invalid login credentials"))
          throw new Error(
            'Contraseña incorrecta. Usa "Olvidé mi contraseña" para recuperarla.'
          );
        throw new Error("Error de autenticación: " + retry.error.message);
      }
      return {
        token: retry.data.session.access_token,
        user: { id: retry.data.user.id },
      };
    }
    throw new Error(
      "Error al iniciar sesión: " +
        signInResult.error.message +
        ". Si el problema persiste, regístrate de nuevo."
    );
  }

  return {
    token: signInResult.data.session.access_token,
    user: { id: signInResult.data.user.id },
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
    throw new Error(
      "El usuario solo puede contener letras, números, guiones bajos (_), puntos (.) y guiones (-). Sin espacios ni @."
    );
  }
  if (cleanUsername.length < 2)
    throw new Error("El usuario debe tener al menos 2 caracteres");

  const dupRes = await fetch(apiUrl("/api/auth/check-duplicate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: cleanUsername, phone: cleanPhone }),
  });
  if (dupRes.ok) {
    const { duplicate } = await dupRes.json();
    if (duplicate === "username")
      throw new Error("El usuario ya está registrado");
    if (duplicate === "phone")
      throw new Error("El teléfono ya está registrado");
  }

  const { data, error } = await supabase.auth.signUp({
    email: `${cleanUsername}@redon.app`,
    password,
  });

  if (error) {
    console.error("[REGISTER] Supabase signUp error:", error.status, error.message, error);
    throw new Error(error.message);
  }
  if (!data.user) throw new Error("Error al crear usuario");

  try {
    await fetch(apiUrl("/api/auth/auto-confirm"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: data.user.id }),
    });
  } catch (e) {
    console.warn("[REGISTER] Auto-confirm failed:", e);
  }

  const upsertRes = await fetch(apiUrl("/api/auth/upsert-profile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: data.user.id,
      name,
      username: cleanUsername,
      phone_number: cleanPhone,
      avatar_url: "",
      bio: "Disponible en RED ON",
      ...(cleanEmail ? { real_email: cleanEmail } : {}),
    }),
  });
  if (!upsertRes.ok) {
    const err = await upsertRes.json();
    if (!err.error?.includes("duplicate key"))
      throw new Error(err.error || "Error al crear perfil");
  }

  let token = data.session?.access_token || "";
  if (!token) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const signInRes = await supabase.auth.signInWithPassword({
          email: `${cleanUsername}@redon.app`,
          password,
        });
        if (signInRes.data.session) {
          token = signInRes.data.session.access_token;
          break;
        }
      } catch (e: any) {
        if (
          e?.message?.toLowerCase().includes("confirm") ||
          e?.message?.toLowerCase().includes("email not confirmed")
        ) {
          await fetch(apiUrl("/api/auth/auto-confirm"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: data.user.id }),
          }).catch(() => {});
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (e?.message?.includes("Invalid login credentials")) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        console.warn("[REGISTER] Sign in attempt", attempt, "failed:", e);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

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
      if (profile.real_email) {
        email = profile.real_email;
      } else {
        email = `${profile.username}@redon.app`;
      }
    }
  } catch {
    // If lookup fails, try the raw input as email
  }

  if (!userFound) {
    throw new Error("No encontramos una cuenta con ese usuario o teléfono.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    if (error.message.includes("Email not found")) {
      throw new Error("No encontramos una cuenta con ese usuario o teléfono.");
    }
    throw new Error("Error al enviar el correo de recuperación: " + error.message);
  }

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
