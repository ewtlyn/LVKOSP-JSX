import { supabase } from "../lib/supabaseClient";

function isValidUserData(data) {
  if (!data) return false;
  if (data.name && String(data.name).includes("C:\\fakepath\\")) return false;
  if (data.username && String(data.username).includes("C:\\fakepath\\"))
    return false;
  return true;
}

function cleanupCorruptedData() {
  try {
    const userStr = localStorage.getItem("lvkosp_user");
    if (userStr) {
      const user = JSON.parse(userStr);
      if (!isValidUserData(user)) {
        localStorage.removeItem("lvkosp_user");
        localStorage.removeItem("lvkosp_user_id");
      }
    }
  } catch {
    localStorage.removeItem("lvkosp_user");
  }
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "lvkosp_salt_2024");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isImageFile(file) {
  if (!file) return false;
  const t = (file.type || "").toLowerCase();
  // Allow empty type (Android file managers) or any image/* or heic/heif
  return !t || t.startsWith("image/") || t.includes("heic") || t.includes("heif");
}

async function compressImage(file, maxSide = 800, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        if (width > height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", quality);
      } catch {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

async function uploadAvatar(file, userId) {
  if (!isImageFile(file))
    throw new Error("Выберите изображение");
  const uploadFile = await compressImage(file, 800, 0.82);
  const filePath = `${userId}/avatar_${Date.now()}.jpg`;
  const contentType = (uploadFile instanceof Blob && uploadFile.type) ? uploadFile.type : "image/jpeg";
  const uploadTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Превышено время загрузки — проверьте соединение")), 30000),
  );
  const { error } = await Promise.race([
    supabase.storage
      .from("avatars")
      .upload(filePath, uploadFile, { cacheControl: "3600", upsert: true, contentType }),
    uploadTimeout,
  ]);
  if (error) {
    if (error.message?.includes('Bucket not found') || error.statusCode === 404 || error.status === 404)
      throw new Error('Бакет "avatars" не найден. Создайте его в Supabase Dashboard → Storage.');
    throw error;
  }
  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(filePath);
  return pub?.publicUrl || "";
}

async function deleteOldAvatar(avatarUrl) {
  try {
    if (!avatarUrl || !avatarUrl.includes("avatars")) return;
    const urlParts = avatarUrl.split("/");
    const fileName = urlParts[urlParts.length - 1];
    const userId = urlParts[urlParts.length - 2];
    await supabase.storage
      .from("avatars")
      .remove([`${userId}/${fileName}`])
      .catch(() => {});
  } catch {}
}

function isNetworkError(error) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    msg.includes("TypeError") ||
    msg.includes("Failed to fetch") ||
    msg.includes("terminated") ||
    error.code === ""
  );
}

async function supabaseRetry(fn, retries = 1, delayMs = 1500) {
  const timeoutResult = {
    data: null,
    error: { message: "timeout", code: "TIMEOUT" },
  };
  const result = await Promise.race([
    fn(),
    new Promise((resolve) => setTimeout(() => resolve(timeoutResult), 8000)),
  ]);
  if (result.error) {
    if (result.error.code === "TIMEOUT") {
      if (retries > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
        return supabaseRetry(fn, retries - 1, delayMs);
      }
      return result;
    }
    if (isNetworkError(result.error) && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return supabaseRetry(fn, retries - 1, delayMs);
    }
  }
  return result;
}

function saveUserLocally(user) {
  const data = {
    id: user.id,
    username: user.username,
    name: user.name,
    avatar_url: user.avatar_url || "",
    banner_url: user.banner_url || "",
    bio: user.bio || "",
    status: "online",
  };
  localStorage.setItem("lvkosp_user_id", user.id);
  localStorage.setItem("lvkosp_user", JSON.stringify(data));
  return data;
}

export class AuthService {
  constructor() {
    cleanupCorruptedData();
  }

  async signUp(username, password, name, avatarFile = null, bio = "") {
    try {
      if (!username || username.length < 3)
        return { success: false, error: "Имя пользователя минимум 3 символа" };
      if (!password || password.length < 6)
        return { success: false, error: "Пароль минимум 6 символов" };
      if (!name || name.length < 2)
        return { success: false, error: "Имя минимум 2 символа" };

      const { data: existingUser, error: checkError } = await supabaseRetry(
        () =>
          supabase
            .from("profiles")
            .select("id")
            .eq("username", username.trim())
            .maybeSingle(),
      );

      if (checkError) {
        console.error("[signUp] check error:", checkError);
        const msg =
          checkError.code === "TIMEOUT"
            ? "Сервер не отвечает — проверьте интернет. На Windows: отключите антивирус/VPN или попробуйте другой браузер."
            : "Ошибка подключения. Попробуйте снова.";
        return { success: false, error: msg };
      }
      if (existingUser)
        return { success: false, error: "Это имя пользователя уже занято" };

      const passwordHash = await hashPassword(password);
      const userId = crypto.randomUUID();

      let avatarUrl = "";
      if (avatarFile) {
        try {
          avatarUrl = await uploadAvatar(avatarFile, userId);
        } catch (e) {
          console.warn("[signUp] avatar upload failed:", e.message);
        }
      }

      const { error: profileError } = await supabaseRetry(() =>
        supabase.from("profiles").insert({
          id: userId,
          username: username.trim(),
          name: name.trim(),
          password_hash: passwordHash,
          avatar_url: avatarUrl,
          bio: bio.trim(),
          created_at: new Date().toISOString(),
          last_seen: new Date().toISOString(),
          status: "online",
        }),
      );

      if (profileError) {
        console.error("[signUp] insert error:", profileError);
        const msg =
          profileError.code === "TIMEOUT"
            ? "Сервер не отвечает — проверьте интернет. На Windows: отключите антивирус/VPN или попробуйте другой браузер."
            : profileError.message || "Ошибка регистрации";
        return { success: false, error: msg };
      }

      const userData = saveUserLocally({
        id: userId,
        username: username.trim(),
        name: name.trim(),
        avatar_url: avatarUrl,
        bio: bio.trim(),
      });
      return { success: true, user: userData };
    } catch (e) {
      console.error("[signUp] catch:", e);
      return { success: false, error: e?.message || "Ошибка регистрации" };
    }
  }

  async signIn(username, password) {
    try {
      if (!username || !password)
        return { success: false, error: "Заполните все поля" };

      const { data: user, error } = await supabaseRetry(() =>
        supabase
          .from("profiles")
          .select("*")
          .eq("username", username.trim())
          .maybeSingle(),
      );

      if (error) {
        console.error("[signIn] error:", error);
        const msg =
          error.code === "TIMEOUT"
            ? "Сервер не отвечает — проверьте интернет. На Windows: отключите антивирус/VPN или попробуйте другой браузер."
            : "Ошибка подключения. Попробуйте снова.";
        return { success: false, error: msg };
      }
      if (!user) return { success: false, error: "Пользователь не найден" };

      const passwordHash = await hashPassword(password);
      if (user.password_hash !== passwordHash)
        return { success: false, error: "Неверный пароль" };

      supabase
        .from("profiles")
        .update({ last_seen: new Date().toISOString(), status: "online" })
        .eq("id", user.id)
        .then(() => {})
        .catch(() => {});

      const userData = saveUserLocally(user);
      return { success: true, user: userData };
    } catch (e) {
      console.error("[signIn] catch:", e);
      return { success: false, error: e?.message || "Ошибка входа" };
    }
  }

  async signOut() {
    try {
      const userId = localStorage.getItem("lvkosp_user_id");
      if (userId) {
        supabase
          .from("profiles")
          .update({ status: "offline", last_seen: new Date().toISOString() })
          .eq("id", userId)
          .then(() => {})
          .catch(() => {});
      }
      localStorage.removeItem("lvkosp_user_id");
      localStorage.removeItem("lvkosp_user");
      localStorage.removeItem("lvkosp_token");
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || "Logout failed" };
    }
  }

  async getCurrentUser() {
    try {
      cleanupCorruptedData();

      const userId = localStorage.getItem("lvkosp_user_id");
      const cachedStr = localStorage.getItem("lvkosp_user");

      if (!userId) return { success: false, error: "Not authenticated" };

      // Если есть кэш — вернуть сразу, а проверку в фоне
      if (cachedStr) {
        try {
          const cached = JSON.parse(cachedStr);
          if (cached && cached.id === userId) {
            // фоновая синхронизация — не блокирует загрузку
            supabase
              .from("profiles")
              .select(
                "id, username, name, avatar_url, banner_url, bio, status, last_seen, is_admin",
              )
              .eq("id", userId)
              .maybeSingle()
              .then(({ data, error }) => {
                if (data) saveUserLocally(data);
                else if (!error) {
                  // профиль не найден в БД — чистим кэш и уведомляем UI
                  localStorage.removeItem("lvkosp_user_id");
                  localStorage.removeItem("lvkosp_user");
                  window.dispatchEvent(new CustomEvent("auth:invalidated"));
                }
              })
              .catch(() => {});
            return { success: true, user: cached };
          }
        } catch {}
      }

      // Нет кэша — нужен запрос к Supabase (с таймаутом 25 сек для медленных сетей)
      const timeout = new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({ data: null, error: { message: "timeout", code: "TIMEOUT" } }),
          25000,
        ),
      );
      const { data: user, error } = await Promise.race([
        supabase
          .from("profiles")
          .select(
            "id, username, name, avatar_url, banner_url, bio, status, last_seen, is_admin",
          )
          .eq("id", userId)
          .maybeSingle(),
        timeout,
      ]);

      if (error) {
        console.error("[getCurrentUser] error:", error);
        if (error.code === "TIMEOUT") {
          return { success: false, error: "Медленное соединение. Проверьте интернет и попробуйте снова." };
        }
        return { success: false, error: "Ошибка соединения" };
      }

      if (!user) {
        localStorage.removeItem("lvkosp_user_id");
        localStorage.removeItem("lvkosp_user");
        return { success: false, error: "User not found" };
      }

      saveUserLocally(user);
      return {
        success: true,
        user: {
          ...user,
          avatar_url: user.avatar_url || "",
          bio: user.bio || "",
        },
      };
    } catch (e) {
      console.error("[getCurrentUser] catch:", e);
      return { success: false, error: e?.message || "Auth check failed" };
    }
  }

  async updateProfile(userId, updates) {
    try {
      const safe = {};
      if (updates?.name?.trim?.()) safe.name = updates.name.trim();
      if (updates?.bio !== undefined) safe.bio = updates.bio?.trim?.() ?? '';
      if (updates?.username?.trim?.()) {
        const uname = updates.username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (uname.length < 3) return { success: false, error: 'Username минимум 3 символа' };
        const { data: existing } = await supabase.from('profiles').select('id').eq('username', uname).neq('id', userId).maybeSingle();
        if (existing) return { success: false, error: 'Username уже занят' };
        safe.username = uname;
      }
      const { data, error } = await supabase
        .from("profiles")
        .update(safe)
        .eq("id", userId)
        .select()
        .single();
      if (error) return { success: false, error: error.message };
      const user = JSON.parse(localStorage.getItem("lvkosp_user") || "{}");
      localStorage.setItem("lvkosp_user", JSON.stringify({ ...user, name: data.name, bio: data.bio || "", username: data.username }));
      return { success: true, user: data };
    } catch (e) {
      return { success: false, error: e?.message || "Profile update failed" };
    }
  }

  async updateAvatar(userId, avatarFile) {
    try {
      const { data: current } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", userId)
        .maybeSingle();
      const oldUrl = current?.avatar_url || "";
      const newUrl = await uploadAvatar(avatarFile, userId);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: newUrl })
        .eq("id", userId);
      if (error) return { success: false, error: error.message };
      await deleteOldAvatar(oldUrl);
      const user = JSON.parse(localStorage.getItem("lvkosp_user") || "{}");
      localStorage.setItem(
        "lvkosp_user",
        JSON.stringify({ ...user, avatar_url: newUrl }),
      );
      return { success: true, avatar_url: newUrl };
    } catch (e) {
      return { success: false, error: e?.message || "Avatar update failed" };
    }
  }

  async updateBanner(userId, bannerFile) {
    try {
      if (!isImageFile(bannerFile))
        return { success: false, error: "Выберите изображение" };
      const uploadFile = await compressImage(bannerFile, 1200, 0.8);
      const filePath = `${userId}/banner_${Date.now()}.jpg`;
      const uploadTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Upload timeout")), 15000),
      );
      const { error: uploadError } = await Promise.race([
        supabase.storage
          .from("avatars")
          .upload(filePath, uploadFile, {
            cacheControl: "3600",
            upsert: true,
            contentType: "image/jpeg",
          }),
        uploadTimeout,
      ]);
      if (uploadError) {
        if (uploadError.message?.includes('Bucket not found') || uploadError.statusCode === 404 || uploadError.status === 404)
          throw new Error('Бакет "avatars" не найден в Supabase Storage. Создайте его в Dashboard → Storage и сделайте публичным.');
        throw uploadError;
      }
      const { data: pub } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);
      const bannerUrl = pub?.publicUrl || "";
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ banner_url: bannerUrl })
        .eq("id", userId);
      if (updateError) return { success: false, error: updateError.message };
      const cached = JSON.parse(localStorage.getItem("lvkosp_user") || "{}");
      localStorage.setItem(
        "lvkosp_user",
        JSON.stringify({ ...cached, banner_url: bannerUrl }),
      );
      return { success: true, banner_url: bannerUrl };
    } catch (e) {
      return { success: false, error: e?.message || "Banner update failed" };
    }
  }

  async changePassword(userId, oldPassword, newPassword) {
    try {
      if (!newPassword || newPassword.length < 6)
        return { success: false, error: "Новый пароль минимум 6 символов" };
      const { data: profile } = await supabase
        .from("profiles")
        .select("password_hash")
        .eq("id", userId)
        .maybeSingle();
      if (!profile) return { success: false, error: "Профиль не найден" };
      const oldHash = await hashPassword(oldPassword);
      if (profile.password_hash !== oldHash)
        return { success: false, error: "Неверный текущий пароль" };
      const newHash = await hashPassword(newPassword);
      const { error } = await supabase
        .from("profiles")
        .update({ password_hash: newHash })
        .eq("id", userId);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || "Ошибка смены пароля" };
    }
  }

  async updateOnlineStatus(userId) {
    try {
      await supabase
        .from("profiles")
        .update({ last_seen: new Date().toISOString(), status: "online" })
        .eq("id", userId);
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  }

  async setPrivate(userId, isPrivate) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_private: isPrivate })
      .eq("id", userId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async getByUsername(username) {
    try {
      const clean = username.startsWith("@") ? username.slice(1) : username;
      const { data } = await supabase
        .from("profiles")
        .select("id, username, name, avatar_url, bio, banner_url")
        .eq("username", clean)
        .maybeSingle();
      return data || null;
    } catch {
      return null;
    }
  }

  async searchUsers(query) {
    if (!query?.trim()) return [];
    const q = query.trim().toLowerCase();
    const { data } = await supabase
      .from("profiles")
      .select("id, username, name, avatar_url")
      .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
      .limit(20);
    return data || [];
  }
}
