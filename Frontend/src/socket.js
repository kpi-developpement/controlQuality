// src/socket.js
import { BACKEND_ORIGIN } from "./backendUrl.js";
import { io } from "socket.io-client";

// BACKEND base without /api for socket.io default path (/socket.io)
const SOCKET_URL = BACKEND_ORIGIN;

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const token = localStorage.getItem("token") || "";
  socket = io(SOCKET_URL, {
    autoConnect: true,
    transports: ["websocket", "polling"],
    auth: { token },
  });

  return socket;
}

export function resetSocketAuth() {
  if (!socket) return;
  const token = localStorage.getItem("token") || "";
  socket.auth = { token };
  if (!socket.connected) socket.connect();
}
