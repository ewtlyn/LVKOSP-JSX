import { supabase } from "../lib/supabaseClient";

async function compressImage(file, maxSide = 1080, quality = 0.85) {
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
      } catch { resolve(file); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export async function composeStory(imageFile, textLayers, stickers) {
  return new Promise(async (resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const W = 1080, H = 1920;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(imageFile); return; }

      // draw image cover-fit
      const imgAspect = img.width / img.height;
      const canvasAspect = W / H;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgAspect > canvasAspect) {
        sw = img.height * canvasAspect;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / canvasAspect;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);

      // draw text layers (coords in %)
      for (const t of textLayers) {
        const fontSize = (t.size || 28) * (W / 390);
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 12;
        ctx.fillStyle = t.color || "white";
        const lines = t.text.split("\n");
        lines.forEach((line, i) => {
          ctx.fillText(line, (t.xPct / 100) * W, (t.yPct / 100) * H + i * fontSize * 1.3);
        });
        ctx.shadowBlur = 0;
      }

      // draw stickers
      for (const s of stickers) {
        ctx.font = `${(s.size || 48) * (W / 390)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(s.emoji, (s.xPct / 100) * W, (s.yPct / 100) * H);
      }

      canvas.toBlob((blob) => resolve(blob || imageFile), "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(imageFile); };
    img.src = objectUrl;
  });
}

export class StoriesService {
  async upload(file, userId) {
    const mimeType = (file?.type || "").toLowerCase();
    if (!file || (!mimeType.startsWith("image/") && !mimeType.includes("heic") && !mimeType.includes("heif") && mimeType !== ""))
      throw new Error("Not an image");
    const compressed = await compressImage(file, 1080, 0.85);
    const path = `stories/${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("post-media")
      .upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
    if (error) throw error;
    return supabase.storage.from("post-media").getPublicUrl(path).data.publicUrl;
  }

  async create(userId, file) {
    const mediaUrl = await this.upload(file, userId);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("stories")
      .insert({ user_id: userId, media_url: mediaUrl, expires_at: expiresAt })
      .select()
      .single();
    if (error) return { success: false, error: error.message };
    return { success: true, story: data };
  }

  async getActive(userIds) {
    if (!userIds?.length) return [];
    const { data } = await supabase
      .from("stories")
      .select(`*, user:profiles(id, username, name, avatar_url)`)
      .in("user_id", userIds)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    return data || [];
  }

  async getMyActive(userId) {
    const { data } = await supabase
      .from("stories")
      .select(`*, user:profiles(id, username, name, avatar_url)`)
      .eq("user_id", userId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    return data || [];
  }

  async delete(storyId) {
    await supabase.from("stories").delete().eq("id", storyId);
  }

  async addView(storyId, viewerId) {
    try {
      await supabase
        .from("story_views")
        .upsert({ story_id: storyId, viewer_id: viewerId }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
    } catch {}
  }

  async getViews(storyId) {
    try {
      const { data } = await supabase
        .from("story_views")
        .select("viewer_id, viewed_at, viewer:profiles(id, name, username, avatar_url)")
        .eq("story_id", storyId)
        .order("viewed_at", { ascending: false });
      return data || [];
    } catch { return []; }
  }

  async getViewCount(storyId) {
    try {
      const { count } = await supabase
        .from("story_views")
        .select("*", { count: "exact", head: true })
        .eq("story_id", storyId);
      return count || 0;
    } catch { return 0; }
  }
}
