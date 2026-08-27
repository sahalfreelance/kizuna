// Registrasi slash command ke Discord. Jalanin SEKALI setiap kali daftar
// command berubah:
//
//     node deploy-commands.js
//
// Kalau REGISTER_GUILD_ID di-set, command didaftarkan per-guild (langsung
// muncul, cocok buat development). Tanpa itu, didaftarkan global (bisa butuh
// sampai 1 jam untuk menyebar).

require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, REGISTER_GUILD_ID } = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("Butuh DISCORD_BOT_TOKEN dan DISCORD_CLIENT_ID di .env");
  process.exit(1);
}

// Catatan penting soal keamanan:
// Semua command di bawah TIDAK menerima argumen password. Argumen slash
// command Discord terlihat oleh semua orang di channel — kalau password
// dikirim sebagai argumen, seisi channel bisa membacanya. Karena itu
// password selalu diisi lewat MODAL (popup form), yang isinya tidak pernah
// masuk ke channel.
const commands = [
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Bikin akun buat login ke website Kizuna (form-nya privat)")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("change-password")
    .setDescription("Ganti password akun website kamu (form-nya privat)")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("reset-device")
    .setDescription("Lepas ikatan perangkat, biar bisa login di HP/browser lain")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("my-account")
    .setDescription("Lihat status akun website kamu")
    .setDMPermission(false),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

(async () => {
  try {
    if (REGISTER_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(DISCORD_CLIENT_ID, REGISTER_GUILD_ID),
        { body: commands }
      );
      console.log(`Command terdaftar di guild ${REGISTER_GUILD_ID}:`);
    } else {
      await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
        body: commands,
      });
      console.log("Command terdaftar global (bisa butuh ~1 jam menyebar):");
    }
    commands.forEach((c) => console.log(`  /${c.name}`));
  } catch (err) {
    console.error("Gagal daftarin command:", err);
    process.exit(1);
  }
})();
