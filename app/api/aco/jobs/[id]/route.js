import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/aco/jobs/<id>
 *
 * Detail job + log-nya. Dipakai halaman /aco buat polling progres realtime.
 * Query param `after` = id log terakhir yang sudah dipegang browser, jadi
 * polling cuma menarik log BARU, bukan mengulang semuanya.
 */
export async function GET(req, { params }) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const after = parseInt(searchParams.get("after") || "0", 10) || 0;

  // Filter user_id: tanpa ini user bisa membaca log job orang lain.
  const { data: job, error: jobError } = await supabaseAdmin
    .from("aco_jobs")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (jobError) {
    console.error("[aco/jobs/:id] GET gagal:", jobError.message);
    return NextResponse.json({ error: "Gagal ambil job." }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job tidak ditemukan." }, { status: 404 });
  }

  const { data: logs, error: logError } = await supabaseAdmin
    .from("aco_logs")
    .select("id, level, message, wallet_address, created_at")
    .eq("job_id", job.id)
    .gt("id", after)
    .order("id", { ascending: true })
    .limit(500);

  if (logError) {
    console.error("[aco/jobs/:id] log gagal:", logError.message);
    return NextResponse.json({ error: "Gagal ambil log." }, { status: 500 });
  }

  // Riwayat percobaan: memperlihatkan auto-retry bekerja — percobaan ke berapa
  // yang berhasil, dan error apa yang membuat percobaan sebelumnya diulang.
  const { data: attempts } = await supabaseAdmin
    .from("aco_attempts")
    .select("id, wallet_address, attempt, outcome, tx_hash, error_kind, error_message, rpc_host, duration_ms, created_at")
    .eq("job_id", job.id)
    .order("id", { ascending: true })
    .limit(200);

  return NextResponse.json({
    data: { job, logs: logs || [], attempts: attempts || [] },
  });
}

/**
 * DELETE /api/aco/jobs/<id>
 *
 * Batalkan job. Hanya untuk yang belum jalan (QUEUED) atau baru di-claim —
 * job yang sudah RUNNING artinya transaksi mungkin sudah dikirim ke chain,
 * dan itu tidak bisa ditarik balik. Worker akan berhenti sendiri saat
 * melihat status CANCELLED sebelum melangkah ke tahap berikutnya.
 */
export async function DELETE(req, { params }) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("aco_jobs")
    .update({
      status: "CANCELLED",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("user_id", auth.userId)
    .in("status", ["QUEUED", "CLAIMED"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[aco/jobs/:id] cancel gagal:", error.message);
    return NextResponse.json({ error: "Gagal batalkan job." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Job tidak ditemukan, atau sudah jalan/selesai sehingga tidak bisa dibatalkan." },
      { status: 409 }
    );
  }

  return NextResponse.json({ data });
}
