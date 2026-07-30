// Bot: dengerin beberapa channel Discord sekaligus (RAFFLE, NFT, CRYPTO),
// begitu ada pesan baru di salah satu channel itu, otomatis kekirim ke
// website dan masuk ke kategori yang sesuai.
//
// Jalanin ini terpisah dari project Next.js, di VPS kalian, 24/7 (pakai pm2).

const { Client, GatewayIntentBits, Events } = require("discord.js");
require("dotenv").config();

const {
  DISCORD_BOT_TOKEN,
  WEBSITE_URL,
  RAFFLE_WEBHOOK_SECRET,
  RAFFLE_CHANNEL_ID,
  NFT_CHANNEL_ID,
  AIRDROP_CHANNEL_ID,
  MINT_CHANNEL_ID,
} = process.env;

// Peta: channel ID -> kategori. Cuma channel yang ID-nya diisi di .env
// yang bakal dipantau; kalau salah satu kosong, ya cuma gak dipantau, gak error.
const CHANNEL_CATEGORY_MAP = {};
if (RAFFLE_CHANNEL_ID) CHANNEL_CATEGORY_MAP[RAFFLE_CHANNEL_ID] = "RAFFLE";
if (NFT_CHANNEL_ID) CHANNEL_CATEGORY_MAP[NFT_CHANNEL_ID] = "NFT";
// Nama env var-nya masih "AIRDROP_CHANNEL_ID" (biar .env yang udah ada gak
// perlu diubah), tapi sekarang di-map ke kategori "CRYPTO" (kategori CRYPTO
// yang lama gak kepake, jadi digabung ke sini).
if (AIRDROP_CHANNEL_ID) CHANNEL_CATEGORY_MAP[AIRDROP_CHANNEL_ID] = "CRYPTO";
if (MINT_CHANNEL_ID) CHANNEL_CATEGORY_MAP[MINT_CHANNEL_ID] = "MINT";

if (!DISCORD_BOT_TOKEN || !WEBSITE_URL || !RAFFLE_WEBHOOK_SECRET) {
  console.error(
    "Env belum lengkap. Wajib ada: DISCORD_BOT_TOKEN, WEBSITE_URL, RAFFLE_WEBHOOK_SECRET"
  );
  process.exit(1);
}
if (Object.keys(CHANNEL_CATEGORY_MAP).length === 0) {
  console.error(
    "Belum ada channel yang di-set. Isi minimal salah satu: RAFFLE_CHANNEL_ID, NFT_CHANNEL_ID, AIRDROP_CHANNEL_ID, MINT_CHANNEL_ID"
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Bot aktif sebagai ${c.user.tag}. Channel yang dipantau:`);
  for (const [channelId, category] of Object.entries(CHANNEL_CATEGORY_MAP)) {
    console.log(`  - ${channelId} -> ${category}`);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

client.on(Events.MessageCreate, async (message) => {
  try {
    const category = CHANNEL_CATEGORY_MAP[message.channel.id];
    if (!category) return; // channel ini gak dipantau
    if (message.author.id === client.user.id) return; // hindari loop kalau bot ini sendiri yang ngirim

    // Discord suka nempelin link-preview/embed BEBERAPA DETIK setelah pesan
    // pertama kali muncul (proses unfurl link-nya async, bukan bagian dari
    // event message pertama). Kalau langsung diproses saat itu juga, embed-nya
    // sering belum nempel -> hasilnya jadi gak lengkap. Jadi kita tunggu dulu,
    // terus fetch ulang pesannya biar dapet versi yang udah lengkap embed-nya.
    await sleep(3000);
    let freshMessage = message;
    try {
      freshMessage = await message.fetch();
    } catch {
      // pesan mungkin kehapus / gak bisa di-fetch ulang -> pakai versi awal aja
    }

    const payload = category === "MINT"
      ? buildMintPayload(freshMessage)
      : buildPayload(freshMessage, category);
    if (!payload.title) return; // pesan kosong / cuma emoji, skip

    const res = await fetch(`${WEBSITE_URL}/api/webhook/garapan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": RAFFLE_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gagal kirim ke website:", res.status, errText);
      return;
    }

    console.log(`[${category}] Terkirim ke website: "${payload.title}"`);
  } catch (err) {
    console.error("Error waktu proses pesan:", err);
  }
});

// Bersihin syntax mentah ala Discord (mention, custom emoji, timestamp
// dinamis) jadi teks biasa yang enak dibaca di web.
function cleanDiscordText(text) {
  if (!text) return text;
  return text
    .replace(/<@&\d+>/g, "")            // role mention
    .replace(/<@!?\d+>/g, "")           // user mention
    .replace(/<#\d+>/g, "")             // channel mention
    .replace(/<a?:\w+:\d+>/g, "")       // custom emoji, misal <:solanasollogo:123>
    .replace(/<t:(\d+)(?::(\w))?>/g, (_, unix, style) => formatDiscordTimestamp(unix, style))
    // rapihin sisa spasi ganda / baris kosong berlebih bekas yang dibuang
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]*[-•:]+[ \t]*/gm, "") // sisa "- " atau ":" nyempil di awal baris
    .replace(/^[^\n:]{1,40}:[ \t]*$/gm, "") // baris "Label:" yang jadi kosong (misal isinya cuma emoji yang kebuang)
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n\n")
    .trim();
}

// <t:UNIX:R> dkk itu timestamp dinamis yang di Discord otomatis nge-update
// ("in 26 seconds" -> "2 minutes ago" seiring waktu). Karena kita simpen
// sebagai teks statis di database, ini diformat sekali jadi kalimat relatif
// (akurat pas disimpen, gak live-ticking di web).
function formatDiscordTimestamp(unixSeconds, style) {
  const date = new Date(parseInt(unixSeconds, 10) * 1000);
  if (style === "R") {
    const diffMs = date.getTime() - Date.now();
    const abs = Math.abs(diffMs);
    const sec = Math.round(abs / 1000);
    const min = Math.round(sec / 60);
    const hr = Math.round(min / 60);
    const day = Math.round(hr / 24);
    let unit;
    if (sec < 60) unit = `${sec} detik`;
    else if (min < 60) unit = `${min} menit`;
    else if (hr < 24) unit = `${hr} jam`;
    else unit = `${day} hari`;
    return diffMs >= 0 ? `dalam ${unit}` : `${unit} yang lalu`;
  }
  return date.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Gabungin description + fields (name: value) jadi 1 blok teks rapi.
// Banyak bot giveaway/raffle nyimpen detail penting (Type, Spots, Ends,
// Requirements, dll) di embed.fields, bukan di description biasa.
// Field "spacer" kosong (dipake bot buat jarak visual doang) di-skip.
function serializeEmbed(embed) {
  let text = embed.description || "";
  if (embed.fields?.length) {
    const isBlank = (s) => !s || s.replace(/[\u200b\s:\-_]/g, "") === "";
    const fieldsText = embed.fields
      .filter((f) => !isBlank(f.name) || !isBlank(f.value))
      .map((f) => `${(f.name || "").replace(/\u200b/g, "").trim().replace(/:+$/, "")}: ${(f.value || "").trim()}`)
      .join("\n");
    text = text ? `${text}\n\n${fieldsText}` : fieldsText;
  }
  return text;
}

// Embed yang paling "detail" (banyak fields + description panjang) diprioritasin
// dibanding embed teaser singkat ("giveaway baru dimulai!") yang suka nongol duluan.
function embedScore(e) {
  return (e.fields?.length || 0) * 50 + (e.description?.length || 0) + (e.title?.length || 0);
}

// Cari timestamp Discord dinamis <t:UNIX:R/F/...> di dalam field yang
// namanya kayak "Ends"/"Expires"/"Deadline" -> dipakai buat nentuin raffle
// itu masih LIVE atau udah harus jadi PAST, dan disimpen buat auto-expire nanti.
function detectRaffleExpiry(embeds) {
  const endFieldPattern = /end|expir|deadline|berakhir|selesai/i;
  for (const e of embeds) {
    for (const f of e.fields || []) {
      if (!endFieldPattern.test(f.name)) continue;
      const match = f.value.match(/<t:(\d+):/);
      if (match) {
        const endTimeMs = parseInt(match[1], 10) * 1000;
        return {
          status: endTimeMs < Date.now() ? "PAST" : "LIVE",
          expiresAt: new Date(endTimeMs).toISOString(),
        };
      }
    }
  }
  return { status: null, expiresAt: null }; // gak ketemu info waktu -> biar default (LIVE)
}

function buildPayload(message, category) {
  // Kalau pesannya di-FORWARD (fitur Forward Discord), konten aslinya
  // (embed, teks, gambar) ada di message.messageSnapshots, BUKAN di
  // message.embeds / message.content langsung (itu bakal kosong).
  const snapshots = message.messageSnapshots
    ? [...message.messageSnapshots.values()]
    : [];

  const embeds = [
    ...(message.embeds || []),
    ...snapshots.flatMap((s) => s.embeds || []),
  ];
  const attachments = [
    ...(message.attachments?.values?.() || []),
    ...snapshots.flatMap((s) => [...(s.attachments?.values?.() || [])]),
  ];
  const rawContent = (
    message.content || snapshots.map((s) => s.content).filter(Boolean).join("\n")
  ).trim();

  // Discord otomatis bikin "link preview" embed (type: link/article/image/video)
  // kalau ada URL di teks pesan — kebanyakan itu BUKAN konten yang sengaja
  // diposting, cuma preview halaman tujuan link-nya (misal iklan wallet).
  // TAPI khusus link Twitter/X, preview-nya justru isinya beneran isi tweet
  // (teks lengkap + gambar) yang emang berharga -> itu dikecualiin, tetep
  // dianggep "informatif" sama kayak embed asli dari bot.
  const embedType = (e) => e?.data?.type || e?.type || "rich";
  const isTwitterEmbed = (e) => /(?:twitter\.com|x\.com)\//i.test(e?.url || "");
  const richEmbeds = embeds.filter((e) => embedType(e) === "rich");
  const informativeEmbeds = [...richEmbeds, ...embeds.filter((e) => embedType(e) !== "rich" && isTwitterEmbed(e))]
    .sort((a, b) => embedScore(b) - embedScore(a)); // paling detail duluan

  // Cari gambar: utamain dari embed yang informatif dulu, baru fallback ke
  // embed/attachment lain kalau emang gak ada gambar sama sekali.
  let imageUrl = null;
  for (const e of [...informativeEmbeds, ...embeds]) {
    if (e.image?.url) { imageUrl = e.image.url; break; }
  }
  if (!imageUrl) {
    for (const e of [...informativeEmbeds, ...embeds]) {
      if (e.thumbnail?.url) { imageUrl = e.thumbnail.url; break; }
    }
  }
  if (!imageUrl) {
    const imageAttachment = attachments.find((a) =>
      a.contentType?.startsWith("image/")
    );
    if (imageAttachment) imageUrl = imageAttachment.url;
  }

  const { status: detectedStatus, expiresAt } =
    category === "RAFFLE" ? detectRaffleExpiry(richEmbeds) : { status: null, expiresAt: null };
  const status = category === "RAFFLE" ? (detectedStatus || "LIVE") : null;

  let title, description, link;

  // Embed rich (dari bot, type: rich) boleh nimpa judul -> biasanya emang
  // dibikin khusus dan lebih deskriptif daripada teks notifikasi pesan.
  const richDetail = richEmbeds.find((e) => e.fields?.length || e.description);
  // Twitter/X card TIDAK boleh nimpa judul (isinya nama akun, bukan judul
  // yang berguna) -> cuma dipakai buat NAMBAHIN isi deskripsi.
  const twitterDetail = embeds.find(
    (e) => embedType(e) !== "rich" && isTwitterEmbed(e) && (e.title || e.description)
  );
  const rawLines = rawContent ? rawContent.split("\n") : [];
  const rawTitle = rawLines[0]?.slice(0, 100);
  const rawBody = rawLines.slice(1).join("\n");

  if (richDetail) {
    link = richDetail.url || message.url;
    const detailText = serializeEmbed(richDetail);

    if (richDetail.title) {
      // Embed punya judul sendiri -> pakai itu, dan deskripsinya cukup dari
      // detail embed-nya aja (teks notifikasi pesan kayak "@role - giveaway
      // baru live!" gak perlu ikut ditampilin, gak nambah info apa-apa).
      title = richDetail.title;
      description = detailText;
    } else {
      // Embed gak punya judul -> pakai baris pertama pesan sebagai judul.
      title = rawTitle;
      description = [rawBody, detailText].filter(Boolean).join("\n\n");
    }
    if (twitterDetail) {
      description = [description, serializeEmbed(twitterDetail)].filter(Boolean).join("\n\n");
    }
  } else if (rawContent) {
    title = rawTitle;
    description = rawBody;
    link = message.url;
    if (twitterDetail) {
      // Isi tweet-nya (kadang berharga banget, kayak watchlist project)
      // digabungin ke deskripsi, dan tombol link diarahin ke tweet aslinya
      // (lebih berguna daripada ke pesan Discord-nya doang).
      // Link mentahnya sendiri dibuang dari body biar gak dobel sama tombol link.
      description = description.replace(twitterDetail.url, "").trim();
      description = [description, serializeEmbed(twitterDetail)].filter(Boolean).join("\n\n");
      link = twitterDetail.url || link;
    }
  } else {
    // Gak ada teks maupun rich embed -> fallback ke twitter card kalau ada,
    // atau embed apapun yang ada (lebih baik daripada kosong total).
    const anyEmbed = twitterDetail || embeds.find((e) => e.title || e.description);
    title = anyEmbed?.title;
    description = anyEmbed?.description || "";
    link = anyEmbed?.url || message.url;
  }

  return {
    category,
    title: cleanDiscordText(title)?.slice(0, 100) || "Garapan baru",
    description: cleanDiscordText(description) || "",
    link,
    image_url: imageUrl,
    created_by: message.author.username,
    status,
    expires_at: expiresAt,
  };
}

// Khusus channel Mint Info: pesannya kadang teks biasa, kadang embed, isinya
// biasanya link OpenSea + kadang link web lain + kadang link Twitter/X buat
// project yang sama. Ini nyari & misahin link-link itu, bukan nyari
// title/fields terstruktur kayak buildPayload() di atas.
function buildMintPayload(message) {
  const snapshots = message.messageSnapshots
    ? [...message.messageSnapshots.values()]
    : [];
  const embeds = [
    ...(message.embeds || []),
    ...snapshots.flatMap((s) => s.embeds || []),
  ];
  const attachments = [
    ...(message.attachments?.values?.() || []),
    ...snapshots.flatMap((s) => [...(s.attachments?.values?.() || [])]),
  ];
  const rawContent = (
    message.content || snapshots.map((s) => s.content).filter(Boolean).join("\n")
  ).trim();

  // Kumpulin semua teks yang mungkin ngandung link: isi pesan + title/description/fields semua embed
  const embedTextParts = embeds.flatMap((e) => [
    e.title,
    e.description,
    e.url,
    ...(e.fields || []).map((f) => f.value),
  ]).filter(Boolean);
  const combinedText = [rawContent, ...embedTextParts].join("\n");

  const urlMatches = combinedText.match(/https?:\/\/[^\s<>()]+/g) || [];
  const openseaUrl = urlMatches.find((u) => /opensea\.io/i.test(u));
  const twitterUrl = urlMatches.find((u) => /(twitter\.com|x\.com)\//i.test(u));
  const otherUrl = urlMatches.find((u) => u !== openseaUrl && u !== twitterUrl);

  // Prioritas link utama: OpenSea dulu, baru link lain, baru fallback ke pesan Discord-nya sendiri
  const primaryLink = openseaUrl || otherUrl || message.url;
  const secondaryLink = twitterUrl || null;

  let imageUrl = null;
  for (const e of embeds) {
    if (e.image?.url) { imageUrl = e.image.url; break; }
  }
  if (!imageUrl) {
    for (const e of embeds) {
      if (e.thumbnail?.url) { imageUrl = e.thumbnail.url; break; }
    }
  }
  if (!imageUrl) {
    const imgAtt = attachments.find((a) => a.contentType?.startsWith("image/"));
    if (imgAtt) imageUrl = imgAtt.url;
  }

  const embedTitle = embeds.find((e) => e.title)?.title;
  let title = embedTitle || rawContent.split("\n")[0];
  if (!title && primaryLink) {
    try { title = new URL(primaryLink).hostname.replace("www.", ""); } catch { title = "Mint Info"; }
  }

  const description = cleanDiscordText(
    embeds.map((e) => e.description).filter(Boolean).join("\n\n") || rawContent
  );

  return {
    category: "MINT",
    title: cleanDiscordText(title)?.slice(0, 100) || "Mint Info",
    description: description || "",
    link: primaryLink,
    secondary_link: secondaryLink,
    image_url: imageUrl,
    created_by: message.author.username,
    status: null,
    expires_at: null,
  };
}

client.login(DISCORD_BOT_TOKEN);
