// Bot: dengerin beberapa channel Discord sekaligus (RAFFLE, NFT, CRYPTO),
// begitu ada pesan baru di salah satu channel itu, otomatis kekirim ke
// website dan masuk ke kategori yang sesuai.
//
// Jalanin ini terpisah dari project Next.js, di VPS kalian, 24/7 (pakai pm2).

const { Client, GatewayIntentBits, Events } = require("discord.js");
require("dotenv").config();

const { registerAccountCommands } = require("./account-commands");

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

// Naikin angka ini tiap kali update kode, biar gampang ngecek di log
// versi mana yang beneran lagi jalan (pm2 logs garapan-bot).
const BOT_VERSION = "v23";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command akun buat login website: /register, /change-password,
// /reset-device, /my-account. Daftarin ke Discord dengan
// `node deploy-commands.js` (sekali, atau tiap kali daftar command berubah).
registerAccountCommands(client);

client.once(Events.ClientReady, (c) => {
  console.log(`Bot aktif sebagai ${c.user.tag} [${BOT_VERSION}]. Channel yang dipantau:`);
  for (const [channelId, category] of Object.entries(CHANNEL_CATEGORY_MAP)) {
    console.log(`  - ${channelId} -> ${category}`);
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pesan yang di-FORWARD embed-nya udah nempel dari awal (snapshot dari
// pesan asli), langsung lengkap. Tapi pesan yang DIKETIK MANUAL sama
// member, link-nya baru di-unfurl Discord belakangan -- dan itu bisa makan
// waktu lebih dari beberapa detik, gak nentu. Jadi kita gak nunggu tetap
// (fixed delay), tapi terus ngecek ulang sampai embed-nya nempel ATAU
// waktu tunggu maksimum abis (biar gak nunggu selamanya kalau emang gak
// bakal ada embed, misal link-nya rusak/gak ke-unfurl).
function countEmbeds(msg) {
  const snapshotEmbeds = msg.messageSnapshots
    ? [...msg.messageSnapshots.values()].flatMap((s) => s.embeds || [])
    : [];
  return (msg.embeds?.length || 0) + snapshotEmbeds.length;
}

function getTextContent(msg) {
  const snapshots = msg.messageSnapshots ? [...msg.messageSnapshots.values()] : [];
  return msg.content || snapshots.map((s) => s.content).filter(Boolean).join("\n");
}

async function waitForEmbeds(message, { maxWaitMs = 10000, intervalMs = 2000 } = {}) {
  const hasUrl = /https?:\/\//.test(getTextContent(message) || "");
  let current = message;
  const startedAt = Date.now();

  // Tunggu awal dikit dulu (embed jarang langsung nempel di milidetik pertama)
  await sleep(1500);
  try {
    current = await current.fetch();
  } catch {
    return current;
  }

  // Pesan yang di-FORWARD embed-nya ada di messageSnapshots (bukan
  // message.embeds), jadi udah lengkap dari awal -> gak perlu nunggu.
  // Yang perlu ditunggu cuma pesan biasa yang linknya belum sempet di-unfurl.
  while (hasUrl && countEmbeds(current) === 0 && Date.now() - startedAt < maxWaitMs) {
    await sleep(intervalMs);
    try {
      current = await current.fetch();
    } catch {
      break; // pesan kehapus / gak bisa di-fetch ulang -> stop, pakai versi terakhir
    }
  }

  return current;
}

// GIF (dari Tenor/Giphy/GIF picker Discord) gak dianggep "link beneran" --
// orang reply pake GIF doang itu candaan, bukan info garapan.
function isGifUrl(url) {
  return /\.gif(?:[?#]|$)/i.test(url) || /(?:tenor\.com|giphy\.com)/i.test(url);
}

// Kalau Discord gagal/lambat nge-unfurl suatu link (gak ada embed sama
// sekali buat link itu), bot fetch sendiri halamannya dan ambil meta
// og:title/og:description/og:image-nya secara manual.
async function fetchOgTags(url, timeoutMs = 4500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KizunaBot/1.0; +https://kizunafnf.vercel.app)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const html = await res.text();
    const getMeta = (prop) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"),
        new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return m[1];
      }
      return null;
    };
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);

    const title = getMeta("og:title") || (titleTag ? titleTag[1].trim() : null);
    if (!title) return null; // gak dapet apa-apa yang berguna

    return {
      title,
      description: getMeta("og:description") || null,
      image: getMeta("og:image") || null,
    };
  } catch {
    return null; // timeout / gagal fetch / bukan HTML -> diem-diem aja, ada fallback lain
  }
}

// Cari URL twitter/x di dalam suatu teks (dipakai buat cari kandidat link
// yang mau di-oEmbed kalau Discord sendiri belum sempet ngunfurl-nya).
function findTwitterUrl(text) {
  const urls = (text || "").match(/https?:\/\/[^\s<>()]+/g) || [];
  return urls.find((u) => /(?:twitter\.com|x\.com)\//i.test(u)) || null;
}

// Kalau Discord BELUM sempet ngunfurl link X jadi embed (dalam batas waktu
// waitForEmbeds), kita gak scrape halaman x.com sendiri (itu SERING gagal --
// X ngeblock request non-browser / butuh render JS). Sebagai gantinya, pakai
// oEmbed API RESMI dari X (publish.twitter.com/oembed) -- ini didesain buat
// dipanggil bot/embed generator, gak butuh auth, dan balikin isi tweet asli
// (author + teks) dalam bentuk HTML kecil yang tinggal di-strip tag-nya.
async function fetchTwitterOEmbed(tweetUrl, timeoutMs = 4500) {
  try {
    const apiUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null; // termasuk tweet yang kehapus/private -> 404

    const data = await res.json();
    if (!data?.html) return null;

    // data.html isinya kira-kira:
    // <blockquote><p lang="..">ISI TWEET</p>&mdash; Nama (@handle) <a href="...">tanggal</a></blockquote>
    // Ambil isi <p> pertama sebagai teks tweet-nya, buang sisa tag & decode entity dasar.
    const pMatch = data.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const rawText = pMatch ? pMatch[1] : data.html;
    const text = rawText
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (!text) return null;

    return {
      url: data.url || tweetUrl,
      title: text.split("\n")[0].slice(0, 100),
      description: data.author_name ? `${text}\n\n— ${data.author_name}` : text,
    };
  } catch (err) {
    console.log(`[debug] fetchTwitterOEmbed error: ${err.message}`);
    return null; // timeout / tweet kehapus / rate-limited -> diem-diem aja, fallback lain masih jalan
  }
}

// Pesan WAJIB ngandung link asli (bukan GIF doang) buat dianggep garapan.
// Ini nyaring obrolan santai kayak "scan qris", "ane gak diajak" dll yang
// numpang lewat di channel yang sama tapi bukan info garapan beneran.
function hasMeaningfulLink(message) {
  const snapshots = message.messageSnapshots
    ? [...message.messageSnapshots.values()]
    : [];
  const embeds = [
    ...(message.embeds || []),
    ...snapshots.flatMap((s) => s.embeds || []),
  ];
  const rawContent = (
    message.content || snapshots.map((s) => s.content).filter(Boolean).join("\n")
  );

  const embedTextParts = embeds.flatMap((e) => [
    e.title, e.description, e.url,
    ...(e.fields || []).map((f) => f.value),
  ]).filter(Boolean);
  const combined = [rawContent, ...embedTextParts].join("\n");

  const urls = combined.match(/https?:\/\/[^\s<>()]+/g) || [];
  return urls.some((u) => !isGifUrl(u));
}

client.on(Events.MessageCreate, async (message) => {
  try {
    const category = CHANNEL_CATEGORY_MAP[message.channel.id];
    if (!category) return; // channel ini gak dipantau
    if (message.author.id === client.user.id) return; // hindari loop kalau bot ini sendiri yang ngirim

    // Pesan yang di-FORWARD datanya (embed, teks, gambar) udah lengkap dari
    // awal lewat messageSnapshots -- gak perlu nunggu ATAU di-fetch ulang.
    // Refetch (buat kasus link yang belum ke-unfurl) itu KHUSUS buat pesan
    // biasa; kalau dipaksain ke pesan forward malah beresiko kehilangan
    // data snapshot-nya (kadang API gak selalu ngirim snapshot lengkap lagi
    // pas di-fetch ulang) -- itu penyebab hasil forward yang sama bisa beda
    // isinya tiap kali diproses.
    const isForwarded = message.messageSnapshots?.size > 0;
    const freshMessage = isForwarded ? message : await waitForEmbeds(message);

    if (!hasMeaningfulLink(freshMessage)) return; // gak ada link beneran (chit-chat / cuma GIF) -> skip

    const payload = category === "MINT"
      ? buildMintPayload(freshMessage)
      : await buildPayload(freshMessage, category);
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

function firstMeaningfulLine(lines) {
  const line = lines.find((l) => l.trim() && !/^https?:\/\/\S+$/.test(l.trim()));
  return line ? line.trim().slice(0, 100) : null;
}

async function buildPayload(message, category) {
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
  // Bedain embed ASLI dari bot (rich, sengaja dibikin) vs LINK-PREVIEW
  // otomatis (hasil unfurl URL sama Discord). Field `type` kadang gak
  // ke-expose konsisten sama discord.js, jadi itu gak bisa diandelin
  // sendirian. Sinyal yang lebih pasti: link-preview otomatis SELALU punya
  // field `provider` (misal {name: "X (formerly Twitter)"}), sementara embed
  // yang sengaja dibikin bot GAK PERNAH punya provider (itu murni buatan
  // Discord buat nunjukkin embed-nya berasal dari unfurl URL, bukan dari bot).
  const isTwitterEmbed = (e) => /(?:twitter\.com|x\.com)\//i.test(e?.url || "");
  const isLinkPreview = (e) => {
    const type = e?.data?.type || e?.type;
    if (type && type !== "rich") return true; // eksplisit ketauan bukan rich
    const provider = e?.data?.provider || e?.provider;
    return Boolean(provider);
  };
  const richEmbeds = embeds.filter((e) => !isLinkPreview(e) && !isTwitterEmbed(e));
  const twitterEmbeds = embeds.filter((e) => isTwitterEmbed(e));
  const informativeEmbeds = [...richEmbeds, ...twitterEmbeds]
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
  let twitterDetail = embeds.find(
    (e) => isTwitterEmbed(e) && (e.title || e.description)
  );
  // Discord belum sempet ngunfurl link X-nya (masih sering kejadian, X lambat
  // banget kadang) -> twitterDetail di atas bakal kosong. Daripada ujung-
  // ujungnya title jatuh ke nama domain doang ("x.com"), coba tarik isi
  // tweet-nya lewat oEmbed API resmi X dulu.
  if (!twitterDetail) {
    const combinedForTwitterSearch = [
      rawContent,
      ...embeds.flatMap((e) => [e.title, e.description, e.url]),
    ].filter(Boolean).join("\n");
    const twitterUrl = findTwitterUrl(combinedForTwitterSearch);
    if (twitterUrl) {
      const oembed = await fetchTwitterOEmbed(twitterUrl);
      if (oembed) {
        twitterDetail = oembed;
        console.log(`[debug] twitterDetail dari oEmbed: title="${oembed.title}"`);
      } else {
        console.log(`[debug] oEmbed gagal/kosong buat ${twitterUrl}`);
      }
    }
  } else {
    console.log(`[debug] twitterDetail dari Discord embed (bukan oEmbed): title="${twitterDetail.title}" desc_len=${(twitterDetail.description || "").length}`);
  }
  const rawLines = rawContent ? rawContent.split("\n") : [];
  const rawTitle = rawLines[0]?.trim().slice(0, 100);
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

    // Kalau baris pertama pesannya ternyata cuma link mentah (bukan teks
    // deskriptif), itu jelek banget kalau jadi judul card. Judul GAK BOLEH
    // berupa URL -- coba beberapa sumber berurutan sampai ketemu yang bagus:
    // 1) link-preview Discord yang punya title+description (misal OG card
    //    resmi project-nya, "PepeMaxiBiz — Mint")
    // 2) kalau Discord gak nyediain itu (gagal/lambat unfurl) -> bot fetch
    //    sendiri halamannya, ambil og:title manual
    // 3) kalau itu juga gagal -> pakai baris teks pertama yang BUKAN link
    // 4) last resort -> nama domainnya aja, tetep bukan URL utuh
    const isBareLinkTitle = /^https?:\/\/\S+$/.test(rawTitle || "");
    if (isBareLinkTitle) {
      const curated = embeds.find(
        (e) => isLinkPreview(e) && !isTwitterEmbed(e) && e.title && e.description
      );
      if (curated) {
        title = curated.title;
        description = [serializeEmbed(curated), rawBody].filter(Boolean).join("\n\n");
        link = curated.url || link;
      } else {
        const urls = rawContent.match(/https?:\/\/[^\s<>()]+/g) || [];
        const primaryUrl = urls.find((u) => !isGifUrl(u));
        // Twitter/X SERING nolak/nge-block request dari bot (bukan browser
        // beneran) -> hasil scrape og:title-nya gak bisa dipercaya. Kita udah
        // punya data asli dari Discord sendiri (twitterDetail, dari card yang
        // di-unfurl Discord), jadi GAK USAH scrape manual buat link
        // twitter/x -- langsung lompat ke fallback teks caption orangnya.
        const skipOgFetch = isTwitterEmbed({ url: primaryUrl });
        const og = primaryUrl && !skipOgFetch ? await fetchOgTags(primaryUrl) : null;
        // Judul HARUS BUKAN URL, titik. Jaga-jaga: apapun sumbernya (termasuk
        // hasil scrape og:title), kalau isinya link mentah lagi, jangan
        // dipake -- ini akar bug "judul masih pake url" yang kejadian pas
        // fetchOgTags balikin sesuatu yang gak valid buat link yang
        // di-block/di-redirect.
        const isUrlLike = (s) => /^https?:\/\/\S+$/.test((s || "").trim());

        if (og?.title && !isUrlLike(og.title)) {
          title = og.title;
          description = [og.description, rawBody].filter(Boolean).join("\n\n");
          link = primaryUrl;
          if (!imageUrl && og.image) imageUrl = og.image;
          console.log(`[debug] title dari og:title manual: "${title}"`);
        } else {
          const fallbackTitle = firstMeaningfulLine(rawLines);
          if (fallbackTitle) {
            title = fallbackTitle;
            console.log(`[debug] title dari firstMeaningfulLine(rawLines): "${title}"`);
          } else if (twitterDetail && (twitterDetail.description || twitterDetail.title)) {
            // Gak ada caption dari orangnya sama sekali (pesan cuma link
            // doang) -> daripada jatuh ke nama domain ("x.com") yang gak
            // informatif, pakai baris pertama ISI TWEET-nya sendiri (udah
            // ke-unfurl Discord jadi twitterDetail) sebagai judul.
            const tweetLines = (twitterDetail.description || twitterDetail.title || "").split("\n");
            const tweetFirstLine = firstMeaningfulLine(tweetLines);
            if (tweetFirstLine) {
              title = tweetFirstLine;
              console.log(`[debug] title dari twitterDetail (baris pertama tweet): "${title}"`);
            } else if (primaryUrl) {
              try { title = new URL(primaryUrl).hostname.replace("www.", ""); } catch { /* biarin */ }
              console.log(`[debug] title jatuh ke hostname (twitterDetail ada tapi firstMeaningfulLine gagal): "${title}"`);
            }
          } else if (primaryUrl) {
            try { title = new URL(primaryUrl).hostname.replace("www.", ""); } catch { /* biarin, fallback "Garapan baru" di return */ }
            console.log(`[debug] title jatuh ke hostname (twitterDetail kosong): "${title}"`);
          }
        }
      }
    }

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

  // JARING PENGAMAN TERAKHIR: gak peduli title itu ditentuin lewat jalur
  // kode yang mana di atas (richDetail, rawContent, atau fallback paling
  // akhir), kalau ujung-ujungnya masih berupa URL mentah, JANGAN dikirim
  // apa adanya -- paksa ambil fallback yang lebih manusiawi. Ini nutupin
  // kemungkinan ada jalur lain (di luar yang udah dijaga di atas) yang
  // ternyata bisa nyetel title jadi link polos juga.
  const isUrlLikeFinal = (s) => /^https?:\/\/\S+$/.test((s || "").trim());
  let finalTitle = cleanDiscordText(title)?.slice(0, 100);
  if (isUrlLikeFinal(finalTitle)) {
    const fallback =
      firstMeaningfulLine(rawLines) ||
      (twitterDetail && firstMeaningfulLine((twitterDetail.description || twitterDetail.title || "").split("\n")));
    if (fallback) {
      finalTitle = cleanDiscordText(fallback)?.slice(0, 100);
    } else {
      try { finalTitle = new URL(finalTitle).hostname.replace("www.", ""); } catch { finalTitle = null; }
    }
  }

  return {
    category,
    title: finalTitle || "Garapan baru",
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
