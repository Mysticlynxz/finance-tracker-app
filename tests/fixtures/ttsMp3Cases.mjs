import { readFileSync } from "node:fs";

// Generated silent MPEG-1 Layer III frames; validated with Windows Media Player.
export const silentMp3 = readFileSync(new URL("./silent.mp3", import.meta.url));
const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);
export const taggedSilentMp3 = Buffer.concat([tag, silentMp3]);
const footerHeader = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 0]);
const footer = Buffer.from([0x33, 0x44, 0x49, 4, 0, 0x10, 0, 0, 0, 0]);
const id3v1 = Buffer.alloc(128);
id3v1.write("TAG");
const id3v22 = Buffer.from([0x49, 0x44, 0x33, 2, 0, 0, 0, 0, 0, 0]);
// v2.3's extended-header size excludes its four-byte size field.
const id3v23Extended = Buffer.from([
  0x49, 0x44, 0x33, 3, 0, 0x40, 0, 0, 0, 10,
  0, 0, 0, 6, 0, 0, 0, 0, 0, 0,
]);
// v2.4's synchsafe extended-header size includes the size field.
const id3v24Extended = Buffer.from([
  0x49, 0x44, 0x33, 4, 0, 0x40, 0, 0, 0, 6,
  0, 0, 0, 6, 1, 0,
]);
export const metadataMp3Cases = [
  ["ID3v2.2", Buffer.concat([id3v22, silentMp3])],
  ["ID3v2.3 extended header", Buffer.concat([id3v23Extended, silentMp3])],
  ["ID3v2.4 extended header", Buffer.concat([id3v24Extended, silentMp3])],
  ["ID3v2.4 footer", Buffer.concat([footerHeader, footer, silentMp3])],
];
export const validMp3Cases = [
  silentMp3,
  taggedSilentMp3,
  Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0]), silentMp3]),
  ...metadataMp3Cases.map(([, audio]) => audio),
  Buffer.concat([silentMp3, id3v1]),
];
export const invalidMp3Cases = [
  ["empty", Buffer.alloc(0)],
  ["three-byte ID3", Buffer.from("ID3")],
  ["invalid ID3 synchsafe size", Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0]), silentMp3])],
  ["ID3 size exceeds payload", Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 1, 0, 0]), silentMp3])],
  ["invalid ID3 extended header", Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x40, 0, 0, 0, 0]), silentMp3])],
  ["missing ID3 footer", Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0x10, 0, 0, 0, 0]), silentMp3])],
  ["ID3 without MPEG frame", tag],
  ["truncated MPEG frame", silentMp3.subarray(0, 416)],
  ["invalid MPEG frame header", Buffer.concat([Buffer.from([0xff, 0xfb, 0xf0, 0x64]), silentMp3.subarray(4)])],
  ["truncated final MPEG frame", silentMp3.subarray(0, -1)],
];
