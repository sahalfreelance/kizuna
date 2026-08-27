import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE } from "./localAuth";

/**
 * Baca sesi di Server Component.
 *
 * Menggantikan `getServerSession(authOptions)` dari next-auth. Sengaja TIDAK
 * query database: ini dipanggil di tiap render halaman, dan tanda tangan HMAC
 * saja sudah cukup untuk menampilkan nama/role di UI. Kalau sesi sebenarnya
 * sudah mati (password diganti / device di-reset), request API pertama dari
 * halaman itu yang akan menolak — di situ session_version dicek ke DB.
 *
 * Bentuk balikannya dibuat mirip session next-auth (`user.name`, `isMember`,
 * `isAdmin`) supaya halaman yang sudah ada tidak perlu diubah banyak.
 */
export function getPageSession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = verifySessionToken(token);
  if (!result.ok) return null;

  const { payload } = result;
  return {
    user: { name: payload.u },
    username: payload.u,
    userId: payload.uid,
    deviceId: payload.did,
    isAdmin: payload.adm === 1,
    isMember: true,
  };
}
