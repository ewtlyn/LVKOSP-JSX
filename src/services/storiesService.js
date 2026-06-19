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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export class StoriesService {
  async upload(file, userId) {
    if (!file || !file.type.startsWith("image/"))
      throw new Error("Not an image");
    const compressed = await compressImage(file, 1080, 0.85);
    const path = `stories/${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("post-media")
      .upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
    if (error) throw error;
    return supabase.storage.from("post-media").getPublicUrl(path).data
      .publicUrl;
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
    const cutoff = new Date().toISOString();
    const { data } = await supabase
      .from("stories")
      .select(`*, user:profiles(id, username, name, avatar_url)`)
      .in("user_id", userIds)
      .gt("expires_at", cutoff)
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
        .upsert(
          { story_id: storyId, viewer_id: viewerId },
          { onConflict: "story_id,viewer_id", ignoreDuplicates: true },
        );
    } catch {}
  }

  async getViews(storyId) {
    try {
      const { data } = await supabase
        .from("story_views")
        .select(
          "viewer_id, viewed_at, viewer:profiles(id, name, username, avatar_url)",
        )
        .eq("story_id", storyId)
        .order("viewed_at", { ascending: false });
      return data || [];
    } catch {
      return [];
    }
  }

  async getViewCount(storyId) {
    try {
      const { count } = await supabase
        .from("story_views")
        .select("*", { count: "exact", head: true })
        .eq("story_id", storyId);
      return count || 0;
    } catch {
      return 0;
    }
  }
}
