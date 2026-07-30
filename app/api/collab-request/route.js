import { NextResponse } from "next/server";
import { getMailTransport } from "@/lib/mailer";

export async function POST(req) {
  const body = await req.json();
  const {
    projectName,
    contactName,
    email,
    discordHandle,
    website,
    twitter,
    message,
    // honeypot: field tersembunyi di form, kalau keisi berarti bot -> diem-diem ditolak
    company,
  } = body;

  if (company) {
    return NextResponse.json({ ok: true }); // bot: pura-pura sukses, jangan kasih tau
  }

  if (!projectName || !contactName || !email || !message) {
    return NextResponse.json(
      { error: "Nama project, contact, email, dan pesan wajib diisi." },
      { status: 400 }
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Format email gak valid." }, { status: 400 });
  }

  try {
    const transport = getMailTransport();
    await transport.sendMail({
      from: `"House of Kizuna" <${process.env.SMTP_USER}>`,
      to: process.env.COLLAB_NOTIFY_EMAIL,
      replyTo: email,
      subject: `[Collab Request] ${projectName}`,
      text: [
        `Project: ${projectName}`,
        `Contact: ${contactName}`,
        `Email: ${email}`,
        discordHandle ? `Discord: ${discordHandle}` : null,
        website ? `Website: ${website}` : null,
        twitter ? `Twitter: ${twitter}` : null,
        "",
        "Message:",
        message,
      ].filter(Boolean).join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Gagal kirim email collab request:", err);
    return NextResponse.json(
      { error: "Gagal mengirim, coba lagi nanti." },
      { status: 500 }
    );
  }
}
