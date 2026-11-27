import React, { useEffect, useState } from "react";
import { getSocket } from "../../socket.js";

/** Pastille « En direct » : état de la connexion temps réel (mises à jour des scores, notifications). */
export default function LivePill() {
  const [online, setOnline] = useState(() => { try { return !!getSocket().connected; } catch { return false; } });

  useEffect(() => {
    let s;
    try { s = getSocket(); } catch { return undefined; }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    s.on("connect", on);
    s.on("disconnect", off);
    s.on("connect_error", off);
    setOnline(!!s.connected);
    return () => { s.off("connect", on); s.off("disconnect", off); s.off("connect_error", off); };
  }, []);

  return (
    <span className={online ? "live-pill" : "live-pill is-off"} role="status" title={online ? "Mises à jour en temps réel actives" : "Temps réel indisponible : actualisez si besoin"}>
      <span className="live-pill__dot" aria-hidden="true" />
      <span className="live-pill__text">{online ? "En direct" : "Hors ligne"}</span>
    </span>
  );
}
