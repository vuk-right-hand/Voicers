// Run with: node --experimental-strip-types --test src/app/download/platform.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMobileUA,
  detectPlatform,
  installerUrlFor,
  installerFilenameFor,
  zipFilenameFor,
} from "./platform.ts";

const UA = {
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  win10Chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  win11Edge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  iPad:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

const NAV = {
  mac: "MacIntel",
  win: "Win32",
  iPhone: "iPhone",
  android: "Linux armv8l",
  empty: "",
};

test("isMobileUA — phones and tablets are mobile", () => {
  assert.equal(isMobileUA(UA.iPhone), true);
  assert.equal(isMobileUA(UA.android), true);
  assert.equal(isMobileUA(UA.iPad), true);
});

test("isMobileUA — desktops are not mobile", () => {
  assert.equal(isMobileUA(UA.macSafari), false);
  assert.equal(isMobileUA(UA.macChrome), false);
  assert.equal(isMobileUA(UA.win10Chrome), false);
  assert.equal(isMobileUA(UA.win11Edge), false);
});

test("detectPlatform — Mac desktops resolve to mac", () => {
  assert.equal(detectPlatform(NAV.mac, UA.macSafari), "mac");
  assert.equal(detectPlatform(NAV.mac, UA.macChrome), "mac");
});

test("detectPlatform — Windows desktops resolve to windows", () => {
  assert.equal(detectPlatform(NAV.win, UA.win10Chrome), "windows");
  assert.equal(detectPlatform(NAV.win, UA.win11Edge), "windows");
});

test("detectPlatform — falls back to UA when navigator.platform is empty", () => {
  // Some browsers (privacy modes) blank navigator.platform — UA must still steer correctly.
  assert.equal(detectPlatform(NAV.empty, UA.macSafari), "mac");
  assert.equal(detectPlatform(NAV.empty, UA.win10Chrome), "windows");
});

test("detectPlatform — both empty defaults to windows (safe default for desktop)", () => {
  assert.equal(detectPlatform("", ""), "windows");
});

test("installerUrlFor — points at correct R2 bucket per platform", () => {
  const win = installerUrlFor("windows");
  const mac = installerUrlFor("mac");
  assert.match(win, /VoicerSetup\.exe$/);
  assert.match(mac, /VoicerInstaller\.dmg$/);
  assert.notEqual(win, mac);
  // Both must be absolute https URLs (no relative paths leaking through)
  assert.match(win, /^https:\/\//);
  assert.match(mac, /^https:\/\//);
});

test("installerUrlFor — mac URL hits the dmg bucket, not the exe bucket", () => {
  // Regression guard: the two R2 buckets have different IDs. If someone copy-pastes
  // the wrong one, the Mac download will silently 404. Verify they differ.
  const win = installerUrlFor("windows");
  const mac = installerUrlFor("mac");
  const winBucket = win.match(/pub-([a-f0-9]+)/)?.[1];
  const macBucket = mac.match(/pub-([a-f0-9]+)/)?.[1];
  assert.ok(winBucket, "windows URL must include a pub-<hash> bucket");
  assert.ok(macBucket, "mac URL must include a pub-<hash> bucket");
  assert.notEqual(winBucket, macBucket, "mac and windows must be on different R2 buckets");
});

test("installerFilenameFor — matches the installer the page bundles", () => {
  assert.equal(installerFilenameFor("windows"), "VoicerSetup.exe");
  assert.equal(installerFilenameFor("mac"), "VoicerInstaller.dmg");
});

test("zipFilenameFor — disambiguates downloads in browser Downloads folder", () => {
  assert.equal(zipFilenameFor("windows"), "VoicerInstaller.zip");
  assert.equal(zipFilenameFor("mac"), "VoicerInstaller-macOS.zip");
  assert.notEqual(zipFilenameFor("windows"), zipFilenameFor("mac"));
});

test("end-to-end: a Mac Safari user gets the dmg pipeline", () => {
  // Simulate the page useEffect logic: NOT mobile → detectPlatform → installer + filename + zip name
  const ua = UA.macSafari;
  const np = NAV.mac;
  assert.equal(isMobileUA(ua), false);
  const plat = detectPlatform(np, ua);
  assert.equal(plat, "mac");
  assert.match(installerUrlFor(plat), /VoicerInstaller\.dmg$/);
  assert.equal(installerFilenameFor(plat), "VoicerInstaller.dmg");
  assert.equal(zipFilenameFor(plat), "VoicerInstaller-macOS.zip");
});

test("end-to-end: a Windows Chrome user gets the exe pipeline", () => {
  const ua = UA.win10Chrome;
  const np = NAV.win;
  assert.equal(isMobileUA(ua), false);
  const plat = detectPlatform(np, ua);
  assert.equal(plat, "windows");
  assert.match(installerUrlFor(plat), /VoicerSetup\.exe$/);
  assert.equal(installerFilenameFor(plat), "VoicerSetup.exe");
  assert.equal(zipFilenameFor(plat), "VoicerInstaller.zip");
});

test("end-to-end: an iPhone user is short-circuited into mobile branch", () => {
  // Mobile branch fires BEFORE platform detection — user sees "open on PC" screen, no download.
  assert.equal(isMobileUA(UA.iPhone), true);
});
