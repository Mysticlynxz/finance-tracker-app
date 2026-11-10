// This module is shared by the mobile player and the deployed Function.
export const isValidMp3 = (bytes) => {
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes.length < 10) return false;
    const version = bytes[3];
    const flags = bytes[5];
    const reservedFlags = version === 2 ? 0x3f : version === 3 ? 0x1f : version === 4 ? 0x0f : 0xff;
    if (reservedFlags === 0xff || bytes[4] === 0xff || (flags & reservedFlags) !== 0 ||
      bytes[6] > 0x7f || bytes[7] > 0x7f || bytes[8] > 0x7f || bytes[9] > 0x7f) return false;
    const size = bytes[6] * 0x200000 + bytes[7] * 0x4000 + bytes[8] * 0x80 + bytes[9];
    const footer = version === 4 && (flags & 0x10) !== 0;
    offset = 10 + size + (footer ? 10 : 0);
    if (offset > bytes.length) return false;
    if (version >= 3 && (flags & 0x40) !== 0) {
      if (size < (version === 3 ? 10 : 6)) return false;
      const extendedSize = version === 4
        ? bytes[10] * 0x200000 + bytes[11] * 0x4000 + bytes[12] * 0x80 + bytes[13]
        : bytes[10] * 0x1000000 + bytes[11] * 0x10000 + bytes[12] * 0x100 + bytes[13] + 4;
      if (version === 4 && (bytes[10] > 0x7f || bytes[11] > 0x7f || bytes[12] > 0x7f || bytes[13] > 0x7f)) return false;
      if (extendedSize < (version === 3 ? 10 : 6) || extendedSize > size) return false;
    }
    if (footer) {
      const start = offset - 10;
      if (bytes[start] !== 0x33 || bytes[start + 1] !== 0x44 || bytes[start + 2] !== 0x49) return false;
      for (let i = 3; i < 10; i++) {
        if (bytes[start + i] !== bytes[i]) return false;
      }
    }
  }

  const bitratesMpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitratesMpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rates = [44100, 48000, 32000];
  let frameCount = 0;
  while (offset < bytes.length) {
    if (frameCount > 0 && bytes.length - offset === 128 &&
      bytes[offset] === 0x54 && bytes[offset + 1] === 0x41 && bytes[offset + 2] === 0x47) {
      return true;
    }
    if (bytes.length - offset < 4 || bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
    const version = (bytes[offset + 1] >> 3) & 3;
    const layer = (bytes[offset + 1] >> 1) & 3;
    const bitrateIndex = bytes[offset + 2] >> 4;
    const rateIndex = (bytes[offset + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3 ||
      (bytes[offset + 3] & 3) === 2) return false;
    const bitrate = (version === 3 ? bitratesMpeg1 : bitratesMpeg2)[bitrateIndex] * 1000;
    const rate = rates[rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const frameLength = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + ((bytes[offset + 2] >> 1) & 1);
    const mono = (bytes[offset + 3] >> 6) === 3;
    const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const minLength = 4 + ((bytes[offset + 1] & 1) === 0 ? 2 : 0) + sideInfo;
    if (frameLength < minLength || offset + frameLength > bytes.length) return false;
    offset += frameLength;
    frameCount++;
  }
  return frameCount > 0;
};
