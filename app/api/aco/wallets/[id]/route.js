import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * DELETE /api/aco/wallets/<id>
 *
 * Hapus wallet. Filter `user_id` wajib ada di query — tanpa itu user bisa
 * menghapus wallet orang lain cuma dengan menebak UUID.
 */
export async function DELETE(req, { params }) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("aco_wallets")
    .delete()
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[aco/wallets] DELETE gagal:", error.message);
    return NextResponse.json({ error: "Gagal hapus wallet." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Wallet tidak ditemukan." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/aco/wallets/<id>
 * body: { is_active?, label? }
 */
export async function PATCH(req, { params }) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const patch = { updated_at: new Date().toISOString() };

  if (typeof body?.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body?.label === "string") patch.label = body.label.slice(0, 60);

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Tidak ada yang diubah." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("aco_wallets")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .select("id, label, address, is_active, created_at")
    .maybeSingle();

  if (error) {
    console.error("[aco/wallets] PATCH gagal:", error.message);
    return NextResponse.json({ error: "Gagal update wallet." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Wallet tidak ditemukan." }, { status: 404 });
  }

  return NextResponse.json({ data });
}
