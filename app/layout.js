import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-mono",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata = {
  title: "House of Kizuna",
  description: "Rangkuman garapan CRYPTO, NFT & RAFFLE komunitas Kizuna.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id" className={`${plexMono.variable} ${plexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
