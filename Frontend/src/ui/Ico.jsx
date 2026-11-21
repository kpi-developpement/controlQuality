import React from "react";
import {
  FiArrowRight, FiArrowLeft, FiBarChart2, FiClipboard, FiCheckCircle, FiHeadphones, FiClock, FiTarget,
  FiCheck, FiAlertTriangle, FiEdit3, FiUser, FiX, FiRefreshCw, FiUsers, FiPhone, FiSettings, FiMessageSquare,
  FiEdit2, FiVideo, FiBookOpen, FiDownload, FiCpu, FiBell, FiPlus, FiTrendingUp, FiRewind, FiFastForward,
  FiAward, FiBriefcase, FiTrash2, FiLock, FiRepeat, FiActivity, FiFileText, FiLayers, FiCornerDownLeft,
  FiCalendar, FiZap, FiSlash, FiThumbsUp, FiXCircle, FiFile, FiGlobe, FiDatabase, FiWifi, FiMapPin, FiKey,
  FiArrowUpRight, FiArrowDownRight, FiPauseCircle, FiFolder, FiCommand, FiGrid, FiAlertCircle, FiInbox,
  FiExternalLink, FiEye, FiEyeOff, FiCopy, FiShuffle, FiChevronRight, FiChevronLeft,
} from "react-icons/fi";

/** Icônes de l'interface (remplacent les emojis). Taille = 1em, hérite de la couleur du texte. */
const MAP = {
  arrowR: FiArrowRight, arrowL: FiArrowLeft, chart: FiBarChart2, clipboard: FiClipboard, checkCircle: FiCheckCircle,
  headphones: FiHeadphones, clock: FiClock, target: FiTarget, check: FiCheck, alert: FiAlertTriangle, edit: FiEdit3,
  user: FiUser, x: FiX, refresh: FiRefreshCw, users: FiUsers, phone: FiPhone, settings: FiSettings,
  message: FiMessageSquare, pencil: FiEdit2, video: FiVideo, book: FiBookOpen, download: FiDownload, bot: FiCpu,
  bell: FiBell, plus: FiPlus, trend: FiTrendingUp, rewind: FiRewind, forward: FiFastForward, award: FiAward,
  building: FiBriefcase, trash: FiTrash2, lock: FiLock, repeat: FiRepeat, activity: FiActivity, fileText: FiFileText,
  layers: FiLayers, enter: FiCornerDownLeft, calendar: FiCalendar, zap: FiZap, slash: FiSlash, thumbsUp: FiThumbsUp,
  xCircle: FiXCircle, file: FiFile, globe: FiGlobe, database: FiDatabase, radio: FiWifi, mapPin: FiMapPin, key: FiKey,
  up: FiArrowUpRight, down: FiArrowDownRight, pause: FiPauseCircle, folder: FiFolder, command: FiCommand, grid: FiGrid,
  alarm: FiAlertCircle, inbox: FiInbox,
  external: FiExternalLink, eye: FiEye, eyeOff: FiEyeOff, copy: FiCopy, shuffle: FiShuffle, chevR: FiChevronRight, chevL: FiChevronLeft,
};

export default function Ico({ n, size, className = "", style, title }) {
  if (n === "dot") {
    return <span className={`ico ico-dot ${className}`} style={style} aria-hidden="true" />;
  }
  const C = MAP[n] || FiAlertCircle;
  return <C className={`ico ${className}`} size={size} style={style} aria-hidden={title ? undefined : "true"} title={title} />;
}
