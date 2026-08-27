// Handler command akun: /register, /change-password, /reset-device, /my-account
//
// Dipasang ke bot yang sudah ada (garapan-bot.js) lewat registerAccountCommands().
//
// Keamanan yang dijaga di sini:
//   1. Password TIDAK PERNAH jadi argumen slash command — selalu lewat modal,
//      karena argumen command terlihat oleh semua orang di channel.
//   2. Semua balasan bot pakai flags MessageFlags.Ephemeral -> cuma user itu
//      yang bisa lihat.
//   3. Password mentah tidak pernah di-log.

const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");

const { supabase } = require("./lib/supabase");
const {
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
  MIN_PASSWORD_LENGTH,
} = require("./lib/localAuth");

const {
  AUTH_CHANNEL_ID,          // channel tempat command akun boleh dipakai
  WEBSITE_URL = "https://kizunafnf.vercel.app",
} = process.env;

const COLOR_OK = 0x34d399;
const COLOR_ERR = 0xf87171;
const COLOR_INFO = 0x6366f1;

/** Command akun cuma boleh dipakai di channel yang ditentukan. */
function wrongChannel(interaction) {
  if (!AUTH_CHANNEL_ID) return false; // belum di-set -> izinkan di mana saja
  return interaction.channelId !== AUTH_CHANNEL_ID;
}

function embed(color, title, description) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

async function replyPrivate(interaction, payload) {
  const data = { ...payload, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(data);
  }
  return interaction.reply(data);
}

function noDb(interaction) {
  return replyPrivate(interaction, {
    embeds: [
      embed(
        COLOR_ERR,
        "Bot belum tersambung ke database",
        "SUPABASE_SERVICE_ROLE_KEY belum di-set di `.env` bot. Hubungi admin."
      ),
    ],
  });
}

/* ------------------------------------------------------------------ modal */

function buildRegisterModal() {
  const modal = new ModalBuilder()
    .setCustomId("acct:register")
    .setTitle("Bikin Akun Website Kizuna");

  const username = new TextInputBuilder()
    .setCustomId("username")
    .setLabel("Username (3-20, huruf/angka/._-)")
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(20)
    .setRequired(true)
    .setPlaceholder("contoh: ujangkedu");

  // Discord tidak punya input bertipe password, jadi teksnya terlihat saat
  // diketik. Tapi isi modal TIDAK pernah dikirim ke channel — hanya ke bot.
  const password = new TextInputBuilder()
    .setCustomId("password")
    .setLabel(`Password (minimal ${MIN_PASSWORD_LENGTH} karakter)`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(MIN_PASSWORD_LENGTH)
    .setMaxLength(128)
    .setRequired(true);

  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Ulangi password")
    .setStyle(TextInputStyle.Short)
    .setMinLength(MIN_PASSWORD_LENGTH)
    .setMaxLength(128)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(username),
    new ActionRowBuilder().addComponents(password),
    new ActionRowBuilder().addComponents(confirm)
  );
  return modal;
}

function buildChangePasswordModal() {
  const modal = new ModalBuilder()
    .setCustomId("acct:change-password")
    .setTitle("Ganti Password");

  const current = new TextInputBuilder()
    .setCustomId("current")
    .setLabel("Password sekarang")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(128);

  const next = new TextInputBuilder()
    .setCustomId("password")
    .setLabel(`Password baru (minimal ${MIN_PASSWORD_LENGTH} karakter)`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(MIN_PASSWORD_LENGTH)
    .setMaxLength(128)
    .setRequired(true);

  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Ulangi password baru")
    .setStyle(TextInputStyle.Short)
    .setMinLength(MIN_PASSWORD_LENGTH)
    .setMaxLength(128)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(current),
    new ActionRowBuilder().addComponents(next),
    new ActionRowBuilder().addComponents(confirm)
  );
  return modal;
}

/* --------------------------------------------------------------- handlers */

async function handleRegisterSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawUsername = interaction.fields.getTextInputValue("username");
  const password = interaction.fields.getTextInputValue("password");
  const confirm = interaction.fields.getTextInputValue("confirm");

  if (password !== confirm) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Password tidak sama", "Isi kedua kolom password dengan nilai yang sama.")],
    });
  }

  const u = validateUsername(rawUsername);
  if (!u.ok) {
    return interaction.editReply({ embeds: [embed(COLOR_ERR, "Username tidak valid", u.error)] });
  }

  const p = validatePassword(password);
  if (!p.ok) {
    return interaction.editReply({ embeds: [embed(COLOR_ERR, "Password tidak valid", p.error)] });
  }

  const discordId = interaction.user.id;

  // 1 akun Discord = 1 username.
  const { data: existingByDiscord, error: e1 } = await supabase
    .from("app_users")
    .select("display_username")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (e1) {
    console.error("[register] query discord_id gagal:", e1.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gangguan database", "Coba lagi beberapa saat.")],
    });
  }

  if (existingByDiscord) {
    return interaction.editReply({
      embeds: [
        embed(
          COLOR_ERR,
          "Kamu sudah punya akun",
          `Username kamu: \`${existingByDiscord.display_username}\`\n\n` +
            "Lupa password? Pakai `/change-password`.\n" +
            "Ganti HP? Pakai `/reset-device`."
        ),
      ],
    });
  }

  const { data: existingByUsername, error: e2 } = await supabase
    .from("app_users")
    .select("id")
    .eq("username", u.username)
    .maybeSingle();

  if (e2) {
    console.error("[register] query username gagal:", e2.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gangguan database", "Coba lagi beberapa saat.")],
    });
  }

  if (existingByUsername) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Username sudah dipakai", `\`${u.username}\` sudah diambil. Coba yang lain.`)],
    });
  }

  const { error: insertError } = await supabase.from("app_users").insert({
    username: u.username,
    display_username: rawUsername.trim(),
    password_hash: hashPassword(p.password),
    discord_id: discordId,
    discord_username: interaction.user.username,
  });

  if (insertError) {
    // 23505 = unique violation, artinya ada yang daftar duluan barusan.
    const isDupe = insertError.code === "23505";
    console.error("[register] insert gagal:", insertError.message);
    return interaction.editReply({
      embeds: [
        embed(
          COLOR_ERR,
          isDupe ? "Username baru saja diambil" : "Gagal bikin akun",
          isDupe ? "Coba username lain." : "Coba lagi beberapa saat."
        ),
      ],
    });
  }

  return interaction.editReply({
    embeds: [
      embed(
        COLOR_OK,
        "Akun berhasil dibuat",
        `Username: \`${u.username}\`\n\n` +
          `Login di ${WEBSITE_URL}/login atau lewat app Android.\n\n` +
          "**Perangkat pertama yang kamu pakai login akan terikat ke akun ini.** " +
          "Kalau nanti ganti HP, jalankan `/reset-device` dulu."
      ),
    ],
  });
}

async function handleChangePasswordSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const current = interaction.fields.getTextInputValue("current");
  const next = interaction.fields.getTextInputValue("password");
  const confirm = interaction.fields.getTextInputValue("confirm");

  if (next !== confirm) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Password tidak sama", "Isi kedua kolom password baru dengan nilai yang sama.")],
    });
  }

  const p = validatePassword(next);
  if (!p.ok) {
    return interaction.editReply({ embeds: [embed(COLOR_ERR, "Password tidak valid", p.error)] });
  }

  const { data: user, error } = await supabase
    .from("app_users")
    .select("id, username, password_hash, session_version")
    .eq("discord_id", interaction.user.id)
    .maybeSingle();

  if (error) {
    console.error("[change-password] query gagal:", error.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gangguan database", "Coba lagi beberapa saat.")],
    });
  }

  if (!user) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Kamu belum punya akun", "Jalankan `/register` dulu.")],
    });
  }

  if (!verifyPassword(current, user.password_hash)) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Password sekarang salah", "Coba lagi.")],
    });
  }

  // session_version dinaikkan -> semua token lama langsung mati, jadi kalau
  // ada yang pernah tahu password lama, sesinya ikut ter-logout.
  const { error: updateError } = await supabase
    .from("app_users")
    .update({
      password_hash: hashPassword(p.password),
      session_version: user.session_version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("[change-password] update gagal:", updateError.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gagal ganti password", "Coba lagi beberapa saat.")],
    });
  }

  return interaction.editReply({
    embeds: [
      embed(
        COLOR_OK,
        "Password berhasil diganti",
        "Semua sesi login yang aktif sudah dikeluarkan. Login ulang pakai password baru.\n\n" +
          "Ikatan perangkat **tidak** berubah — kalau mau pindah HP, pakai `/reset-device`."
      ),
    ],
  });
}

async function handleResetDevice(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data: user, error } = await supabase
    .from("app_users")
    .select("id, username, device_id, device_label, session_version")
    .eq("discord_id", interaction.user.id)
    .maybeSingle();

  if (error) {
    console.error("[reset-device] query gagal:", error.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gangguan database", "Coba lagi beberapa saat.")],
    });
  }

  if (!user) {
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Kamu belum punya akun", "Jalankan `/register` dulu.")],
    });
  }

  if (!user.device_id) {
    return interaction.editReply({
      embeds: [
        embed(
          COLOR_INFO,
          "Belum ada perangkat terikat",
          "Akun kamu belum pernah dipakai login. Langsung login saja — perangkat yang kamu pakai akan otomatis terikat."
        ),
      ],
    });
  }

  const previous = user.device_label || "perangkat sebelumnya";

  // device_id dikosongkan DAN session_version dinaikkan, supaya sesi di
  // perangkat lama langsung mati (bukan cuma dilepas ikatannya).
  const { error: updateError } = await supabase
    .from("app_users")
    .update({
      device_id: null,
      device_label: null,
      device_bound_at: null,
      session_version: user.session_version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("[reset-device] update gagal:", updateError.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gagal reset perangkat", "Coba lagi beberapa saat.")],
    });
  }

  return interaction.editReply({
    embeds: [
      embed(
        COLOR_OK,
        "Ikatan perangkat dilepas",
        `Perangkat lama (${previous}) sudah ter-logout.\n\n` +
          "Sekarang login di perangkat baru — perangkat itu yang akan terikat ke akun kamu."
      ),
    ],
  });
}

async function handleMyAccount(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { data: user, error } = await supabase
    .from("app_users")
    .select("display_username, device_label, device_bound_at, last_login_at, is_admin, is_active")
    .eq("discord_id", interaction.user.id)
    .maybeSingle();

  if (error) {
    console.error("[my-account] query gagal:", error.message);
    return interaction.editReply({
      embeds: [embed(COLOR_ERR, "Gangguan database", "Coba lagi beberapa saat.")],
    });
  }

  if (!user) {
    return interaction.editReply({
      embeds: [embed(COLOR_INFO, "Kamu belum punya akun", "Jalankan `/register` untuk bikin akun.")],
    });
  }

  const fmt = (v) => (v ? `<t:${Math.floor(new Date(v).getTime() / 1000)}:R>` : "—");

  const lines = [
    `**Username:** \`${user.display_username}\``,
    `**Status:** ${user.is_active ? "aktif" : "dinonaktifkan"}${user.is_admin ? " · admin" : ""}`,
    `**Perangkat:** ${user.device_label || "belum terikat"}`,
    `**Terikat sejak:** ${fmt(user.device_bound_at)}`,
    `**Login terakhir:** ${fmt(user.last_login_at)}`,
  ];

  return interaction.editReply({
    embeds: [embed(COLOR_INFO, "Akun Website Kizuna", lines.join("\n"))],
  });
}

/* ------------------------------------------------------------- pemasangan */

const ACCOUNT_COMMANDS = new Set([
  "register",
  "change-password",
  "reset-device",
  "my-account",
]);

/**
 * Kembalikan true kalau interaction ini sudah ditangani di sini, supaya
 * garapan-bot.js tahu tidak perlu memprosesnya lagi.
 */
async function handleAccountInteraction(interaction) {
  // Submit modal
  if (interaction.isModalSubmit?.() && interaction.customId.startsWith("acct:")) {
    if (!supabase) {
      await noDb(interaction);
      return true;
    }
    try {
      if (interaction.customId === "acct:register") {
        await handleRegisterSubmit(interaction);
      } else if (interaction.customId === "acct:change-password") {
        await handleChangePasswordSubmit(interaction);
      }
    } catch (err) {
      console.error("[account] error modal:", err);
      await replyPrivate(interaction, {
        embeds: [embed(COLOR_ERR, "Terjadi error", "Coba lagi beberapa saat.")],
      }).catch(() => {});
    }
    return true;
  }

  if (!interaction.isChatInputCommand?.()) return false;
  if (!ACCOUNT_COMMANDS.has(interaction.commandName)) return false;

  if (wrongChannel(interaction)) {
    await replyPrivate(interaction, {
      embeds: [
        embed(
          COLOR_ERR,
          "Salah channel",
          `Command akun cuma bisa dipakai di <#${AUTH_CHANNEL_ID}>.`
        ),
      ],
    });
    return true;
  }

  if (!supabase) {
    await noDb(interaction);
    return true;
  }

  try {
    switch (interaction.commandName) {
      // showModal TIDAK boleh didahului defer/reply — Discord menolaknya.
      case "register":
        await interaction.showModal(buildRegisterModal());
        break;
      case "change-password":
        await interaction.showModal(buildChangePasswordModal());
        break;
      case "reset-device":
        await handleResetDevice(interaction);
        break;
      case "my-account":
        await handleMyAccount(interaction);
        break;
    }
  } catch (err) {
    console.error(`[account] error /${interaction.commandName}:`, err);
    await replyPrivate(interaction, {
      embeds: [embed(COLOR_ERR, "Terjadi error", "Coba lagi beberapa saat.")],
    }).catch(() => {});
  }

  return true;
}

function registerAccountCommands(client) {
  client.on("interactionCreate", async (interaction) => {
    await handleAccountInteraction(interaction);
  });

  const where = AUTH_CHANNEL_ID ? `channel ${AUTH_CHANNEL_ID}` : "semua channel";
  console.log(`Command akun aktif (${where}): /register /change-password /reset-device /my-account`);
}

module.exports = { registerAccountCommands, handleAccountInteraction };
