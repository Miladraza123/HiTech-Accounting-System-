// Lightweight, dependency-free User-Agent summary — just enough to tell
// two login rows apart at a glance ("Chrome on Windows" vs "Safari on
// iPhone"); not meant to be a precise device-detection library.
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";

  let os = "Unknown OS";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/CriOS\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}
