export type Platform = "windows" | "mac";

export const WINDOWS_INSTALLER_URL =
  process.env.NEXT_PUBLIC_INSTALLER_URL ??
  "https://pub-aa1b48d86cfc49d69effbf73a4f10cee.r2.dev/VoicerSetup.exe";

export const MAC_INSTALLER_URL =
  process.env.NEXT_PUBLIC_MAC_INSTALLER_URL ??
  "https://pub-ab293b0d3d6d4fd188ae2c2155f079d0.r2.dev/VoicerInstaller.dmg";

export function isMobileUA(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);
}

export function detectPlatform(navPlatform: string, userAgent: string): Platform {
  return /Mac|iPhone|iPad|iPod/i.test(navPlatform || userAgent) ? "mac" : "windows";
}

export function installerUrlFor(platform: Platform): string {
  return platform === "mac" ? MAC_INSTALLER_URL : WINDOWS_INSTALLER_URL;
}

export function installerFilenameFor(platform: Platform): string {
  return platform === "mac" ? "VoicerInstaller.dmg" : "VoicerSetup.exe";
}

export function zipFilenameFor(platform: Platform): string {
  return platform === "mac" ? "VoicerInstaller-macOS.zip" : "VoicerInstaller.zip";
}
