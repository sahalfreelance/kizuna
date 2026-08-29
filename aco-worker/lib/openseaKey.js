import { supabase } from "./supabase.js";
import { decryptPrivateKey } from "./walletCrypto.js";

/**
 * Ambil API key OpenSea untuk satu user.
 *
 * Tiap user punya key sendiri. Ini penting: rate limit pemakaian key berlaku
 * per key, jadi kalau satu key dipakai bersama, mint yang jalan bersamaan
 * saling berebut kuota dan sebagian gagal.
 *
 * Urutan yang dicoba:
 *   1. Endpoint internal website (?user_id=...) — jalur utama
 *   2. Baca langsung dari tabel aco_user_keys — cadangan kalau website mati
 *   3. Key bersama (tabel opensea_api_keys)
 *   4. OPENSEA_API_KEY dari .env
 *
 * Cache per user, TTL pendek. Key bisa dirotasi saat user login, jadi cache
 * yang terlalu lama berisiko memakai key yang sudah diganti.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // userId -> { key, at, source }

async function fromWebsite(userId) {
  const base = process.env.WEBSITE_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!base || !secret) return null;

  try {
    const url = new URL(`${base.replace(/\/$/, "")}/api/internal/opensea-key`);
    if (userId) url.searchParams.set("user_id", userId);

    const res = await fetch(url, {
      headers: { "x-worker-secret": secret },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text();
      console.log(`  [openseaKey] website balas ${res.status}: ${body.slice(0, 120)}`);
      return null;
    }

    const json = await res.json();
    if (json.api_key) {
      return { key: json.api_key, source: json.source || "website" };
    }
  } catch (err) {
    console.log(`  [openseaKey] gagal hubungi website: ${err?.message ?? err}`);
  }
  return null;
}

async function fromUserTable(userId) {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from("aco_user_keys")
      .select("encrypted_key, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      console.log("  [openseaKey] key user sudah kedaluwarsa");
      return null;
    }

    return { key: decryptPrivateKey(data.encrypted_key), source: "user-db" };
  } catch (err) {
    console.log(`  [openseaKey] gagal baca aco_user_keys: ${err?.message ?? err}`);
    return null;
  }
}

async function fromSharedTable() {
  try {
    const { data, error } = await supabase
      .from("opensea_api_keys")
      .select("encrypted_key, expires_at")
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;

    return { key: decryptPrivateKey(data.encrypted_key), source: "shared-db" };
  } catch {
    return null;
  }
}

export async function getOpenseaApiKey(userId, { force = false } = {}) {
  const cacheKey = userId || "__shared__";

  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.key;
  }

  const found =
    (await fromWebsite(userId)) ||
    (await fromUserTable(userId)) ||
    (await fromSharedTable()) ||
    (process.env.OPENSEA_API_KEY
      ? { key: process.env.OPENSEA_API_KEY, source: "env" }
      : null);

  if (!found) return null;

  cache.set(cacheKey, { key: found.key, at: Date.now(), source: found.source });
  console.log(`  [openseaKey] pakai key dari ${found.source} (…${found.key.slice(-4)})`);
  return found.key;
}

/** Dipakai kalau OpenSea menolak key (401/403). */
export function invalidateCache(userId) {
  if (userId) cache.delete(userId);
  else cache.clear();
}
