"use client";

import { useState } from "react";
import { explorerTxUrl } from "@/lib/chains";

/**
 * Galeri NFT hasil mint.
 *
 * Data datang dari worker (`job.preflight.items`) yang membacanya dari LOG
 * TRANSAKSI di chain — bukan dari OpenSea. Jadi token id selalu ada walau
 * OpenSea belum mengindeks gambarnya.
 *
 * Gambar NFT sering di IPFS dan bisa lambat/gagal. Karena itu setiap kartu
 * punya fallback: kalau gambar tidak muncul, token id tetap tampil besar dan
 * link ke explorer/OpenSea tetap bisa diklik.
 */

function ItemCard({ item, chain }) {
  const [imgState, setImgState] = useState(item.imageUrl ? "loading" : "none");

  const label = item.name || `#${item.tokenId}`;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 5,
        overflow: "hidden",
        background: "var(--bg2)",
      }}
    >
      {/* Kotak gambar rasio 1:1 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: "var(--bg1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {imgState === "ok" || imgState === "loading" ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt={label}
              onLoad={() => setImgState("ok")}
              onError={() => setImgState("error")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: imgState === "ok" ? "block" : "none",
              }}
            />
            {imgState === "loading" && (
              <span style={{ fontSize: 9.5, color: "var(--text-dim)" }}>memuat…</span>
            )}
          </>
        ) : (
          // Tanpa gambar: token id dibuat besar supaya kartunya tetap berguna.
          <div style={{ textAlign: "center", padding: 8 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--text-mid)",
                fontFamily: "var(--font-mono)",
              }}
            >
              #{item.tokenId}
            </div>
            <div style={{ fontSize: 8.5, color: "var(--text-dim)", marginTop: 3 }}>
              {imgState === "error" ? "gambar gagal dimuat" : "belum terindeks"}
            </div>
          </div>
        )}

        {item.quantity > 1 && (
          <span
            style={{
              position: "absolute",
              top: 5,
              right: 5,
              background: "rgba(0,0,0,0.75)",
              border: "1px solid var(--border)",
              borderRadius: 3,
              padding: "1px 5px",
              fontSize: 9,
              color: "var(--text)",
            }}
          >
            ×{item.quantity}
          </span>
        )}
      </div>

      <div style={{ padding: "7px 8px 8px" }}>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={label}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 9,
            color: "var(--text-dim)",
            marginTop: 2,
            display: "flex",
            gap: 5,
            alignItems: "center",
          }}
        >
          <span>#{item.tokenId}</span>
          {item.standard && <span>· {item.standard}</span>}
        </div>

        <div style={{ display: "flex", gap: 7, marginTop: 6 }}>
          {item.openseaUrl && (
            <a
              href={item.openseaUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 9, color: "var(--indigo-dim)", textDecoration: "none" }}
            >
              opensea ↗
            </a>
          )}
          {item.wallet && (
            <span style={{ fontSize: 9, color: "var(--text-dim)", marginLeft: "auto" }}>
              {item.wallet.slice(0, 6)}…{item.wallet.slice(-4)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MintedItems({ items, chain, txHash }) {
  if (!items?.length) return null;

  const total = items.reduce((n, i) => n + (i.quantity || 1), 0);
  const withImage = items.filter((i) => i.imageUrl).length;

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: 0.8,
            color: "var(--text-dim)",
            fontWeight: 700,
          }}
        >
          ITEM YANG DIDAPAT
        </span>
        <span style={{ fontSize: 10, color: "var(--crypto)" }}>
          {total} item
        </span>
        {withImage < items.length && (
          <span style={{ fontSize: 9, color: "var(--text-dim)" }}>
            · {items.length - withImage} belum ada gambar (OpenSea biasanya butuh
            beberapa menit untuk mengindeks)
          </span>
        )}
        {txHash && chain && (
          <a
            href={explorerTxUrl(chain, txHash) || "#"}
            target="_blank"
            rel="noreferrer"
            style={{
              marginLeft: "auto",
              fontSize: 9.5,
              color: "var(--indigo-dim)",
              textDecoration: "none",
            }}
          >
            lihat tx ↗
          </a>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
          gap: 8,
        }}
      >
        {items.map((it, i) => (
          <ItemCard key={`${it.contract}-${it.tokenId}-${i}`} item={it} chain={chain} />
        ))}
      </div>
    </div>
  );
}
